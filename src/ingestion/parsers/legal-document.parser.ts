import { SectionType, ChunkType, DocumentType, DocumentStatus } from '@prisma/client';

export interface ParsedSection {
  sectionType: SectionType;
  number?: string;
  title?: string;
  content: string;
  orderIndex: number;
  children?: ParsedSection[];
}

export interface ParsedDocument {
  source: {
    name: string;
    baseUrl?: string;
  };
  documentType: DocumentType;
  officialId: string;
  title: string;
  summary?: string;
  publicationDate: string;
  effectiveDate?: string;
  status: DocumentStatus;
  officialUrl?: string;
  metadata?: Record<string, unknown>;
  versionTag: string;
  sections: ParsedSection[];
}

/**
 * Mapea el tipo de sección al tipo de chunk más adecuado.
 * La normativa jurídica tiene una estructura formal que
 * requiere esta correspondencia para mantener las citas correctas.
 */
export function sectionTypeToChunkType(sectionType: SectionType): ChunkType {
  switch (sectionType) {
    case 'ARTICULO':
    case 'APARTADO':
      return 'ARTICULO_COMPLETO';
    case 'DISPOSICION_ADICIONAL':
    case 'DISPOSICION_TRANSITORIA':
    case 'DISPOSICION_DEROGATORIA':
    case 'DISPOSICION_FINAL':
      return 'DISPOSICION';
    case 'ANEXO':
      return 'ANEXO_FRAGMENTO';
    case 'PREAMBULO':
      return 'PREAMBULO_FRAGMENTO';
    default:
      return 'ARTICULO_COMPLETO';
  }
}

/**
 * Estimación aproximada de tokens para texto en español.
 * Para castellano jurídico, ~1 token ≈ 4 caracteres es razonable.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parsea un archivo JSON estructurado con el formato esperado.
 * Este parser es la primera versión; en el futuro se añadirán
 * parsers para BOE XML, PDF, etc.
 */
export function parseJsonDocument(raw: string): ParsedDocument {
  const data = JSON.parse(raw);

  if (!data.officialId || !data.title || !data.sections) {
    throw new Error('El JSON debe contener al menos: officialId, title, sections');
  }

  return {
    source: {
      name: data.source?.name || 'BOE',
      baseUrl: data.source?.baseUrl,
    },
    documentType: data.documentType || 'LEY',
    officialId: data.officialId,
    title: data.title,
    summary: data.summary,
    publicationDate: data.publicationDate,
    effectiveDate: data.effectiveDate,
    status: data.status || 'VIGENTE',
    officialUrl: data.officialUrl,
    metadata: data.metadata,
    versionTag: data.versionTag || 'original',
    sections: parseSections(data.sections),
  };
}

function parseSections(sections: unknown[], startIndex = 0): ParsedSection[] {
  if (!Array.isArray(sections)) return [];

  return sections.map((s: Record<string, unknown>, i: number) => ({
    sectionType: (s.sectionType as SectionType) || 'ARTICULO',
    number: s.number as string | undefined,
    title: s.title as string | undefined,
    content: s.content as string,
    orderIndex: startIndex + i,
    children: s.children ? parseSections(s.children as unknown[], 0) : undefined,
  }));
}
