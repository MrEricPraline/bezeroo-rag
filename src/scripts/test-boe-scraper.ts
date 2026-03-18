import { scrapeBoe } from '../ingestion/scrapers/boe.scraper';

async function main() {
  const url = process.argv[2] || 'https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690';

  console.log(`Scrapeando: ${url}\n`);
  const doc = await scrapeBoe(url);

  console.log('=== Metadata ===');
  console.log(`  Tipo:          ${doc.documentType}`);
  console.log(`  ID oficial:    ${doc.officialId}`);
  console.log(`  Título:        ${doc.title}`);
  console.log(`  Publicación:   ${doc.publicationDate}`);
  console.log(`  Entrada vigor: ${doc.effectiveDate}`);
  console.log(`  Fuente:        ${doc.source.name}`);
  console.log(`  URL:           ${doc.officialUrl}`);
  console.log(`  Versión:       ${doc.versionTag}`);
  console.log(`  Secciones:     ${doc.sections.length}`);
  console.log();

  console.log('=== Secciones ===');
  for (const s of doc.sections) {
    const contentPreview = s.content.substring(0, 80).replace(/\n/g, ' ');
    console.log(`  [${s.orderIndex}] ${s.sectionType} ${s.number || ''} — ${s.title || '(sin título)'}`);
    console.log(`      ${contentPreview}...`);
    console.log(`      (${s.content.length} chars)`);
  }
}

main().catch(console.error);
