import { Injectable, Logger } from '@nestjs/common';
import { OpenaiService } from '../openai/openai.service';
import { LegalChunksService, ChunkWithScore } from '../legal-chunks/legal-chunks.service';

export interface RagResponse {
  answer: string;
  citations: Citation[];
  matchedChunks: MatchedChunk[];
}

export interface Citation {
  officialId: string;
  documentTitle: string;
  sectionType: string;
  sectionNumber: string | null;
  sectionTitle: string | null;
  versionTag: string;
}

export interface MatchedChunk {
  id: string;
  content: string;
  score: number;
  citation: Citation;
}

const SYSTEM_PROMPT = `Eres un asistente jurídico especializado en normativa ambiental española. Tu función es responder preguntas basándote exclusivamente en los fragmentos de normativa que se te proporcionan como contexto.

Reglas estrictas:
1. Responde SOLO con información contenida en el contexto proporcionado.
2. Cita siempre la norma, artículo y apartado específico de donde extraes la información.
3. Si el contexto no contiene información suficiente para responder, indícalo claramente.
4. Usa un lenguaje técnico-jurídico pero comprensible.
5. Estructura la respuesta de forma clara.
6. Al citar, usa el formato: [NormaOficial, Artículo X] o [NormaOficial, Disposición X].
7. No inventes ni extrapoles información que no esté en el contexto.`;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly chunksService: LegalChunksService,
  ) {}

  async query(question: string, maxChunks = 5): Promise<RagResponse> {
    this.logger.log(`Consulta RAG: "${question}"`);

    const queryEmbedding = await this.openaiService.generateEmbedding(question);
    const chunks = await this.chunksService.searchSimilar(queryEmbedding, maxChunks);

    if (chunks.length === 0) {
      return {
        answer: 'No se han encontrado fragmentos de normativa relevantes para esta consulta.',
        citations: [],
        matchedChunks: [],
      };
    }

    const context = this.buildContext(chunks);
    const userMessage = `Contexto normativo:\n\n${context}\n\n---\n\nPregunta: ${question}`;
    const answer = await this.openaiService.chat(SYSTEM_PROMPT, userMessage);

    const matchedChunks: MatchedChunk[] = chunks.map((c) => ({
      id: c.id,
      content: c.content,
      score: Number(c.score),
      citation: {
        officialId: c.officialId,
        documentTitle: c.documentTitle,
        sectionType: c.sectionType,
        sectionNumber: c.sectionNumber,
        sectionTitle: c.sectionTitle,
        versionTag: c.versionTag,
      },
    }));

    const citations = this.deduplicateCitations(matchedChunks.map((m) => m.citation));

    return { answer, citations, matchedChunks };
  }

  private buildContext(chunks: ChunkWithScore[]): string {
    return chunks
      .map((c, i) => {
        const ref = [c.officialId, c.sectionType, c.sectionNumber, c.sectionTitle]
          .filter(Boolean)
          .join(' — ');
        return `[Fragmento ${i + 1}] ${ref}\n${c.content}`;
      })
      .join('\n\n');
  }

  private deduplicateCitations(citations: Citation[]): Citation[] {
    const seen = new Set<string>();
    return citations.filter((c) => {
      const key = `${c.officialId}|${c.sectionType}|${c.sectionNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
