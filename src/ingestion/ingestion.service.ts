import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { LegalDocumentsService } from '../legal-documents/legal-documents.service';
import { LegalChunksService, CreateSectionInput, CreateChunkInput } from '../legal-chunks/legal-chunks.service';
import { OpenaiService } from '../openai/openai.service';
import {
  ParsedDocument,
  ParsedSection,
  parseJsonDocument,
  sectionTypeToChunkType,
  estimateTokens,
} from './parsers/legal-document.parser';
import { scrapeBoe } from './scrapers/boe.scraper';
import * as fs from 'fs';
import * as path from 'path';

export interface IngestOptions {
  force?: boolean;
}

export type IngestResult = {
  jobId: string;
  documentId: string;
  versionId: string;
  sectionsCreated: number;
  chunksCreated: number;
  status: 'COMPLETED' | 'SKIPPED';
  skippedReason?: string;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: LegalDocumentsService,
    private readonly chunksService: LegalChunksService,
    private readonly openaiService: OpenaiService,
  ) {}

  async ingestFromFile(filePath: string, versionTagOverride?: string, opts?: IngestOptions) {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Archivo no encontrado: ${absolutePath}`);
    }

    const raw = fs.readFileSync(absolutePath, 'utf-8');
    const parsed = parseJsonDocument(raw);
    if (versionTagOverride) {
      parsed.versionTag = versionTagOverride;
    }

    return this.ingestParsedDocument(parsed, absolutePath, opts);
  }

  async ingestFromBoeUrl(url: string, opts?: IngestOptions) {
    this.logger.log(`Scrapeando BOE: ${url}`);
    const parsed = await scrapeBoe(url);
    this.logger.log(`Parseadas ${parsed.sections.length} secciones de ${parsed.officialId}`);
    return this.ingestParsedDocument(parsed, url, opts);
  }

  private async ingestParsedDocument(
    parsed: ParsedDocument,
    sourceRef: string,
    opts?: IngestOptions,
  ): Promise<IngestResult> {
    const contentHash = this.hashContent(parsed);
    const existing = await this.documentsService.findByOfficialId(parsed.officialId);

    if (existing) {
      const existingHash = (existing as any).metadata?.contentHash;

      if (!opts?.force && existingHash === contentHash) {
        this.logger.log(
          `"${parsed.officialId}" sin cambios (hash=${contentHash.slice(0, 8)}). Saltando.`,
        );
        return {
          jobId: '',
          documentId: existing.id,
          versionId: existing.versions[0]?.id ?? '',
          sectionsCreated: 0,
          chunksCreated: 0,
          status: 'SKIPPED',
          skippedReason: 'Contenido idéntico al ya ingestado',
        };
      }

      if (!opts?.force) {
        throw new ConflictException(
          `El documento "${parsed.officialId}" ya está ingestado (id: ${existing.id}). ` +
          `Usa force=true para re-ingestar.`,
        );
      }

      this.logger.log(`Re-ingestando "${parsed.officialId}" (contenido actualizado)`);
      for (const v of existing.versions) {
        await this.chunksService.deleteByVersionId(v.id);
      }
    }

    const mergedMetadata = { ...parsed.metadata, contentHash };

    const job = await this.prisma.ingestionJob.create({
      data: {
        sourceFile: sourceRef,
        status: 'PROCESSING',
        startedAt: new Date(),
      },
    });

    try {
      this.logger.log(`Ingestando: ${parsed.officialId} — ${parsed.title}`);

      const { document, version } = await this.documentsService.createWithVersion({
        sourceName: parsed.source.name,
        sourceBaseUrl: parsed.source.baseUrl,
        documentType: parsed.documentType,
        officialId: parsed.officialId,
        title: parsed.title,
        summary: parsed.summary,
        publicationDate: new Date(parsed.publicationDate),
        effectiveDate: parsed.effectiveDate ? new Date(parsed.effectiveDate) : undefined,
        status: parsed.status,
        officialUrl: parsed.officialUrl,
        metadata: mergedMetadata,
        versionTag: parsed.versionTag,
      });

      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: { documentId: document.id },
      });

      await this.chunksService.deleteByVersionId(version.id);

      const chunks = await this.createSectionsAndChunks(version.id, parsed.sections);

      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          totalSections: parsed.sections.length,
          totalChunks: chunks.length,
          status: 'EMBEDDING',
        },
      });

      this.logger.log(`Generando embeddings para ${chunks.length} chunks...`);
      const texts = chunks.map((c) => c.content);
      const embeddings = await this.openaiService.generateEmbeddings(texts);

      const pairs = chunks.map((c, i) => ({
        chunkId: c.id,
        embedding: embeddings[i],
      }));
      await this.chunksService.storeEmbeddingsBatch(pairs);

      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          processedChunks: chunks.length,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Ingestión completada: ${chunks.length} chunks con embeddings`,
      );

      return {
        jobId: job.id,
        documentId: document.id,
        versionId: version.id,
        sectionsCreated: parsed.sections.length,
        chunksCreated: chunks.length,
        status: 'COMPLETED',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      this.logger.error(`Ingestión fallida: ${message}`);
      throw error;
    }
  }

  private hashContent(parsed: ParsedDocument): string {
    const canonical = parsed.sections
      .map((s) => `${s.sectionType}|${s.number ?? ''}|${s.content}`)
      .join('\n');
    return createHash('sha256').update(canonical).digest('hex');
  }

  private async createSectionsAndChunks(
    versionId: string,
    sections: ParsedSection[],
    parentId?: string,
  ): Promise<{ id: string; content: string }[]> {
    const allChunks: { id: string; content: string }[] = [];

    for (const section of sections) {
      const sectionInput: CreateSectionInput = {
        versionId,
        parentId,
        sectionType: section.sectionType,
        number: section.number,
        title: section.title,
        content: section.content,
        orderIndex: section.orderIndex,
      };

      const created = await this.chunksService.createSection(sectionInput);

      const chunkInput: CreateChunkInput = {
        sectionId: created.id,
        versionId,
        chunkType: sectionTypeToChunkType(section.sectionType),
        content: this.buildChunkContent(section),
        tokenCount: estimateTokens(section.content),
        orderIndex: section.orderIndex,
        metadata: {
          sectionType: section.sectionType,
          number: section.number,
          title: section.title,
        },
      };

      const chunk = await this.chunksService.createChunk(chunkInput);
      allChunks.push({ id: chunk.id, content: chunkInput.content });

      if (section.children?.length) {
        const childChunks = await this.createSectionsAndChunks(
          versionId,
          section.children,
          created.id,
        );
        allChunks.push(...childChunks);
      }
    }

    return allChunks;
  }

  /**
   * Construye el texto del chunk incluyendo contexto de la sección,
   * para que el embedding capture bien la referencia jurídica.
   */
  private buildChunkContent(section: ParsedSection): string {
    const parts: string[] = [];

    if (section.number) {
      parts.push(`${section.sectionType} ${section.number}`);
    }
    if (section.title) {
      parts.push(section.title);
    }
    parts.push(section.content);

    return parts.join('. ');
  }
}
