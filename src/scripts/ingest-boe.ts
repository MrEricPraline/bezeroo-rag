import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

async function main() {
  const url = process.argv[2];

  if (!url || !url.includes('boe.es')) {
    console.error('Uso: npx ts-node src/scripts/ingest-boe.ts <URL_BOE>');
    console.error('Ejemplo: npx ts-node src/scripts/ingest-boe.ts https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const ingestionService = app.get(IngestionService);

  try {
    console.log(`\nIngestando desde BOE: ${url}\n`);
    const result = await ingestionService.ingestFromBoeUrl(url);

    console.log('\n=== Ingestión completada ===');
    console.log(`  Job ID:     ${result.jobId}`);
    console.log(`  Documento:  ${result.documentId}`);
    console.log(`  Versión:    ${result.versionId}`);
    console.log(`  Secciones:  ${result.sectionsCreated}`);
    console.log(`  Chunks:     ${result.chunksCreated}`);
    console.log(`  Estado:     ${result.status}`);
    console.log();
  } catch (error) {
    console.error('Error durante la ingestión:', error);
    process.exit(1);
  }

  await app.close();
}

main();
