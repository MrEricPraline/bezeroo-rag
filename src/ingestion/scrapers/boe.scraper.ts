import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { SectionType, DocumentType, DocumentStatus } from '@prisma/client';
import { ParsedDocument, ParsedSection } from '../parsers/legal-document.parser';

interface BoeMetadata {
  title: string;
  boeId: string;
  publicationDate: string;
  effectiveDate?: string;
  department?: string;
  permalink?: string;
}

/**
 * Scrapes a BOE consolidated legislation page and returns
 * a structured ParsedDocument ready for ingestion.
 */
export async function scrapeBoe(url: string): Promise<ParsedDocument> {
  const boeId = extractBoeId(url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const metadata = extractMetadata($, boeId);
  const sections = extractSections($);

  return {
    source: { name: 'BOE', baseUrl: 'https://www.boe.es' },
    documentType: detectDocumentType(metadata.title),
    officialId: extractOfficialId(metadata.title),
    title: metadata.title,
    summary: undefined,
    publicationDate: metadata.publicationDate,
    effectiveDate: metadata.effectiveDate,
    status: 'VIGENTE' as DocumentStatus,
    officialUrl: url,
    versionTag: 'consolidado',
    metadata: {
      boeId: metadata.boeId,
      department: metadata.department,
      permalink: metadata.permalink,
    },
    sections,
  };
}

function extractBoeId(url: string): string {
  const match = url.match(/id=(BOE-A-[\d-]+)/);
  if (!match) throw new Error(`No se pudo extraer el ID del BOE de la URL: ${url}`);
  return match[1];
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'bezeroo-rag/0.1 (legal-research)',
      'Accept-Language': 'es',
    },
  });
  if (!response.ok) {
    throw new Error(`Error al descargar ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function extractMetadata($: cheerio.CheerioAPI, boeId: string): BoeMetadata {
  const title = $('h3.documento-tit').first().text().trim();

  const metaMap: Record<string, string> = {};
  $('dl.conso dt').each((_, dt) => {
    const key = $(dt).text().trim().replace(':', '');
    const value = $(dt).next('dd').text().trim();
    metaMap[key] = value;
  });

  const pubText = metaMap['Publicado en'] || '';
  const pubDateMatch = pubText.match(/de (\d{2}\/\d{2}\/\d{4})/);

  return {
    title,
    boeId,
    publicationDate: pubDateMatch ? convertDate(pubDateMatch[1]) : new Date().toISOString().split('T')[0],
    effectiveDate: metaMap['Entrada en vigor'] ? convertDate(metaMap['Entrada en vigor']) : undefined,
    department: metaMap['Departamento'],
    permalink: metaMap['Permalink ELI'],
  };
}

/** Converts dd/mm/yyyy to yyyy-mm-dd */
function convertDate(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

function extractSections($: cheerio.CheerioAPI): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let orderIndex = 0;

  $('div.bloque').each((_, el) => {
    const block = $(el);
    const blockId = block.attr('id') || '';

    // Skip preámbulo and firma blocks
    if (blockId === 'pr' || blockId === 'fi') return;

    const h5 = block.find('h5.articulo').first();
    if (h5.length) {
      const heading = h5.text().trim();
      const contentParagraphs = collectParagraphs(block, $);

      if (!contentParagraphs) return;

      const classified = classifyHeading(heading);
      sections.push({
        sectionType: classified.sectionType,
        number: classified.number,
        title: classified.title,
        content: contentParagraphs,
        orderIndex: orderIndex++,
      });
      return;
    }

    // Annexes: h4.anexo_num + h4.anexo_tit
    const anexoNum = block.find('h4.anexo_num').first();
    if (anexoNum.length) {
      const number = anexoNum.text().trim().replace(/^ANEXO\s+/, '');
      const title = block.find('h4.anexo_tit').first().text().trim();
      const contentParagraphs = collectParagraphs(block, $);

      if (!contentParagraphs) return;

      sections.push({
        sectionType: 'ANEXO' as SectionType,
        number,
        title,
        content: contentParagraphs,
        orderIndex: orderIndex++,
      });
    }
  });

  return sections;
}

/**
 * Collects all paragraph text from a block, stripping HTML tags
 * but preserving the logical structure with line breaks.
 */
function collectParagraphs(block: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  block.find('p').each((_, p) => {
    const cls = $(p).attr('class') || '';
    // Skip block ID markers
    if (cls === 'bloque') return;

    const text = $(p).text().trim();
    if (text && !text.startsWith('[Bloque')) {
      parts.push(text);
    }
  });

  // Also collect blockquote content (used in disposiciones finales that modify other laws)
  block.find('blockquote p').each((_, p) => {
    const text = $(p).text().trim();
    if (text) parts.push(text);
  });

  return parts.join('\n');
}

interface ClassifiedHeading {
  sectionType: SectionType;
  number?: string;
  title?: string;
}

function classifyHeading(heading: string): ClassifiedHeading {
  // "Disposición adicional primera. Título."
  const dispoPatterns: { regex: RegExp; type: SectionType }[] = [
    { regex: /^Disposición adicional\s+(\S+)\.\s*(.*)$/i, type: 'DISPOSICION_ADICIONAL' },
    { regex: /^Disposición transitoria\s+(\S+)\.\s*(.*)$/i, type: 'DISPOSICION_TRANSITORIA' },
    { regex: /^Disposición derogatoria\s+(\S+)\.\s*(.*)$/i, type: 'DISPOSICION_DEROGATORIA' },
    { regex: /^Disposición final\s+(\S+)\.\s*(.*)$/i, type: 'DISPOSICION_FINAL' },
  ];

  for (const { regex, type } of dispoPatterns) {
    const match = heading.match(regex);
    if (match) {
      return {
        sectionType: type,
        number: match[1].replace(/\.$/, ''),
        title: match[2]?.replace(/\.$/, '').trim() || undefined,
      };
    }
  }

  // "Artículo 1. Objeto y finalidad."
  const artMatch = heading.match(/^(?:«)?Artículo\s+([\d\s\w.]+?)\.\s*(.*)$/i);
  if (artMatch) {
    return {
      sectionType: 'ARTICULO',
      number: artMatch[1].trim(),
      title: artMatch[2]?.replace(/\.$/, '').trim() || undefined,
    };
  }

  // Fallback
  return {
    sectionType: 'ARTICULO',
    title: heading.replace(/\.$/, ''),
  };
}

function detectDocumentType(title: string): DocumentType {
  const t = title.toLowerCase();
  if (t.includes('ley orgánica')) return 'LEY_ORGANICA';
  if (t.includes('real decreto-ley')) return 'REAL_DECRETO_LEY';
  if (t.includes('real decreto legislativo')) return 'REAL_DECRETO_LEGISLATIVO';
  if (t.includes('real decreto')) return 'REAL_DECRETO';
  if (t.includes('ley')) return 'LEY';
  if (t.includes('orden')) return 'ORDEN_MINISTERIAL';
  if (t.includes('directiva')) return 'DIRECTIVA_UE';
  if (t.includes('reglamento')) return 'REGLAMENTO_UE';
  return 'OTRO';
}

/**
 * Extracts the official short identifier from the full title.
 * e.g. "Real Decreto 1055/2022, de 27 de diciembre, ..." → "Real Decreto 1055/2022"
 */
function extractOfficialId(title: string): string {
  const match = title.match(
    /^((?:Real Decreto(?:-Ley| Legislativo)?|Ley(?: Orgánica)?|Orden \S+|Directiva|Reglamento)\s+[\d/]+)/i,
  );
  return match ? match[1] : title.split(',')[0].trim();
}
