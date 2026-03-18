import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DocumentType, DocumentStatus, Prisma } from '@prisma/client';

export interface CreateDocumentInput {
  sourceName: string;
  sourceBaseUrl?: string;
  documentType: DocumentType;
  officialId: string;
  title: string;
  summary?: string;
  publicationDate: Date;
  effectiveDate?: Date;
  status?: DocumentStatus;
  officialUrl?: string;
  metadata?: Record<string, unknown>;
  versionTag: string;
  rawContent?: string;
}

@Injectable()
export class LegalDocumentsService {
  private readonly logger = new Logger(LegalDocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const docs = await this.prisma.legalDocument.findMany({
      include: {
        source: true,
        versions: {
          select: { id: true, versionTag: true, publishedAt: true },
        },
        _count: { select: { versions: true } },
      },
      orderBy: { publicationDate: 'desc' },
    });

    const enriched = await Promise.all(
      docs.map(async (doc) => {
        const chunkCount = await this.prisma.legalChunk.count({
          where: { version: { documentId: doc.id } },
        });
        return { ...doc, chunkCount };
      }),
    );

    return enriched;
  }

  async findById(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id },
      include: {
        source: true,
        versions: {
          include: {
            sections: {
              orderBy: { orderIndex: 'asc' },
              where: { parentId: null },
              include: {
                children: { orderBy: { orderIndex: 'asc' } },
              },
            },
            _count: { select: { chunks: true, sections: true } },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException(`Documento ${id} no encontrado`);
    return doc;
  }

  async findByOfficialId(officialId: string) {
    return this.prisma.legalDocument.findUnique({
      where: { officialId },
      include: {
        versions: { select: { id: true, versionTag: true } },
      },
    });
  }

  async existsByOfficialId(officialId: string): Promise<boolean> {
    const count = await this.prisma.legalDocument.count({
      where: { officialId },
    });
    return count > 0;
  }

  async deleteDocument(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Documento ${id} no encontrado`);

    // Cascade: chunks → sections → versions → document (Prisma onDelete handles it)
    await this.prisma.legalDocument.delete({ where: { id } });

    // Clean up orphan ingestion jobs
    await this.prisma.ingestionJob.deleteMany({ where: { documentId: id } });

    this.logger.log(`Documento eliminado: ${doc.officialId} — ${doc.title}`);
    return { deleted: true, officialId: doc.officialId, title: doc.title };
  }

  async getStats() {
    const [documents, versions, sections, chunks, jobs] = await Promise.all([
      this.prisma.legalDocument.count(),
      this.prisma.legalVersion.count(),
      this.prisma.legalSection.count(),
      this.prisma.legalChunk.count(),
      this.prisma.ingestionJob.groupBy({
        by: ['status'],
        _count: true,
      }),
    ]);

    const chunksWithEmbedding = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT count(*) FROM legal_chunks WHERE embedding IS NOT NULL`,
    );

    return {
      documents,
      versions,
      sections,
      chunks: {
        total: chunks,
        withEmbedding: Number(chunksWithEmbedding[0]?.count ?? 0),
      },
      ingestionJobs: Object.fromEntries(
        jobs.map((j) => [j.status, j._count]),
      ),
    };
  }

  async createWithVersion(input: CreateDocumentInput) {
    const source = await this.prisma.legalSource.upsert({
      where: { name: input.sourceName },
      update: {},
      create: {
        name: input.sourceName,
        baseUrl: input.sourceBaseUrl,
      },
    });

    const document = await this.prisma.legalDocument.upsert({
      where: { officialId: input.officialId },
      update: {
        title: input.title,
        summary: input.summary,
        status: input.status || 'VIGENTE',
        officialUrl: input.officialUrl,
        metadata: (input.metadata as Prisma.InputJsonValue) || undefined,
      },
      create: {
        sourceId: source.id,
        documentType: input.documentType,
        officialId: input.officialId,
        title: input.title,
        summary: input.summary,
        publicationDate: input.publicationDate,
        effectiveDate: input.effectiveDate,
        status: input.status || 'VIGENTE',
        officialUrl: input.officialUrl,
        metadata: (input.metadata as Prisma.InputJsonValue) || undefined,
      },
    });

    const version = await this.prisma.legalVersion.upsert({
      where: {
        documentId_versionTag: {
          documentId: document.id,
          versionTag: input.versionTag,
        },
      },
      update: { rawContent: input.rawContent },
      create: {
        documentId: document.id,
        versionTag: input.versionTag,
        rawContent: input.rawContent,
        publishedAt: input.publicationDate,
      },
    });

    return { document, version };
  }
}
