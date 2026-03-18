import { ParsedDocument } from './legal-document.parser';

/**
 * Para implementar el parser de PDF, se necesita:
 *
 * 1. Instalar dependencia: npm install pdf-parse (o pdfjs-dist)
 * 2. Extraer texto del PDF con estructura (headings, párrafos)
 * 3. Detectar la estructura jurídica: artículos, disposiciones, anexos
 * 4. Producir un ParsedDocument que el pipeline de ingestión consume directamente
 *
 * La parte difícil: los PDFs legales suelen tener formato de dos columnas,
 * headers/footers repetidos, y numeración inconsistente. pdf-parse maneja
 * el texto plano; para PDFs complejos considerar OCR (tesseract) o APIs
 * como Azure Document Intelligence.
 */
export async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  throw new Error(
    'Parser de PDF no implementado todavía. ' +
    'Instala pdf-parse y completa la extracción de estructura jurídica.',
  );
}
