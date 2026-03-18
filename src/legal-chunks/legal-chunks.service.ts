import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChunkType, SectionType, Prisma } from '@prisma/client';

export interface CreateSectionInput {
  versionId: string;
  parentId?: string;
  sectionType: SectionType;
  number?: string;
  title?: string;
  content: string;
  orderIndex: number;
}

export interface CreateChunkInput {
  sectionId: string;
  versionId: string;
  chunkType: ChunkType;
  content: string;
  tokenCount: number;
  orderIndex: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkWithScore {
  id: string;
  content: string;
  chunkType: ChunkType;
  score: number;
  metadata: Record<string, unknown> | null;
  sectionNumber: string | null;
  sectionTitle: string | null;
  sectionType: SectionType;
  documentTitle: string;
  officialId: string;
  versionTag: string;
}

@Injectable()
export class LegalChunksService {
  private readonly logger = new Logger(LegalChunksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSection(input: CreateSectionInput) {
    return this.prisma.legalSection.create({ data: input });
  }

  async createChunk(input: CreateChunkInput) {
    return this.prisma.legalChunk.create({
      data: {
        ...input,
        metadata: (input.metadata as Prisma.InputJsonValue) || undefined,
      },
    });
  }

  async storeEmbedding(chunkId: string, embedding: number[]) {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE legal_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
      vectorStr,
      chunkId,
    );
  }

  async storeEmbeddingsBatch(pairs: { chunkId: string; embedding: number[] }[]) {
    for (const { chunkId, embedding } of pairs) {
      await this.storeEmbedding(chunkId, embedding);
    }
  }

  async searchSimilar(queryEmbedding: number[], limit = 5, threshold = 0.3): Promise<ChunkWithScore[]> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const results = await this.prisma.$queryRawUnsafe<ChunkWithScore[]>(
      `
      SELECT
        c.id,
        c.content,
        c."chunkType" as "chunkType",
        1 - (c.embedding <=> $1::vector) as score,
        c.metadata,
        s.number as "sectionNumber",
        s.title as "sectionTitle",
        s."sectionType" as "sectionType",
        d.title as "documentTitle",
        d."officialId" as "officialId",
        v."versionTag" as "versionTag"
      FROM legal_chunks c
      JOIN legal_sections s ON c."sectionId" = s.id
      JOIN legal_versions v ON c."versionId" = v.id
      JOIN legal_documents d ON v."documentId" = d.id
      WHERE c.embedding IS NOT NULL
        AND 1 - (c.embedding <=> $1::vector) > $2
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3
      `,
      vectorStr,
      threshold,
      limit,
    );

    return results;
  }

  async deleteByVersionId(versionId: string) {
    await this.prisma.legalChunk.deleteMany({ where: { versionId } });
    await this.prisma.legalSection.deleteMany({ where: { versionId } });
  }
}
