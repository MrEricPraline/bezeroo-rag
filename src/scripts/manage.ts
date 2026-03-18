import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService, IngestResult } from '../ingestion/ingestion.service';
import { LegalDocumentsService } from '../legal-documents/legal-documents.service';

const COMMANDS = {
  list: 'Listar documentos ingestados',
  stats: 'Estadísticas del sistema',
  'ingest-boe': 'Ingestar norma del BOE <url> [--force]',
  'ingest-file': 'Ingestar desde JSON local <path> [--force]',
  'update-all': 'Re-scrapear todo y actualizar solo lo que cambió',
  delete: 'Eliminar documento <id>',
  reset: 'Eliminar TODOS los documentos --confirm',
};

function printUsage() {
  console.log('\n  bezeroo-rag — Gestión de normativa\n');
  console.log('  Uso: npm run manage <comando> [argumentos]\n');
  console.log('  Comandos:');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`    ${cmd.padEnd(16)} ${desc}`);
  }
  console.log();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || !Object.keys(COMMANDS).includes(command)) {
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: command === 'list' || command === 'stats' ? false : ['error', 'warn', 'log'],
  });

  const docs = app.get(LegalDocumentsService);
  const ingestion = app.get(IngestionService);
  const hasFlag = (flag: string) => args.includes(flag);

  try {
    switch (command) {
      case 'list': {
        const all = await docs.findAll();
        if (all.length === 0) {
          console.log('\n  No hay documentos ingestados.\n');
          break;
        }
        console.log(`\n  ${all.length} documento(s) ingestado(s):\n`);
        for (const d of all) {
          console.log(`  [${d.id.slice(0, 8)}]  ${d.officialId}`);
          console.log(`            ${d.title}`);
          console.log(`            ${d.documentType} · ${d.status} · ${d.chunkCount} chunks`);
          console.log();
        }
        break;
      }

      case 'stats': {
        const s = await docs.getStats();
        console.log('\n  === Estadísticas del sistema ===\n');
        console.log(`  Documentos:    ${s.documents}`);
        console.log(`  Versiones:     ${s.versions}`);
        console.log(`  Secciones:     ${s.sections}`);
        console.log(`  Chunks total:  ${s.chunks.total}`);
        console.log(`  Con embedding: ${s.chunks.withEmbedding}`);
        console.log(`  Ingestion jobs: ${JSON.stringify(s.ingestionJobs)}`);
        console.log();
        break;
      }

      case 'ingest-boe': {
        const url = args.find((a) => !a.startsWith('--'));
        if (!url || !url.includes('boe.es')) {
          console.error('  Error: falta URL del BOE');
          console.error('  Uso: npm run manage ingest-boe <url> [--force]');
          process.exit(1);
        }
        console.log(`\n  Ingestando desde BOE: ${url}\n`);
        const result = await ingestion.ingestFromBoeUrl(url, {
          force: hasFlag('--force'),
        });
        printIngestResult(result);
        break;
      }

      case 'ingest-file': {
        const filePath = args.find((a) => !a.startsWith('--'));
        if (!filePath) {
          console.error('  Error: falta ruta del archivo');
          console.error('  Uso: npm run manage ingest-file <path> [--force]');
          process.exit(1);
        }
        console.log(`\n  Ingestando archivo: ${filePath}\n`);
        const result = await ingestion.ingestFromFile(filePath, undefined, {
          force: hasFlag('--force'),
        });
        printIngestResult(result);
        break;
      }

      case 'delete': {
        const id = args[0];
        if (!id) {
          console.error('  Error: falta ID del documento');
          console.error('  Uso: npm run manage delete <id>');
          process.exit(1);
        }
        const full = await findDocumentByPartialId(docs, id);
        const result = await docs.deleteDocument(full.id);
        console.log(`\n  Documento eliminado: ${result.officialId}`);
        console.log(`  ${result.title}\n`);
        break;
      }

      case 'update-all': {
        const all = await docs.findAll();
        const boeUrls = all
          .filter((d) => d.officialUrl?.includes('boe.es'))
          .map((d) => d.officialUrl!);

        if (boeUrls.length === 0) {
          console.log('\n  No hay documentos del BOE para actualizar.\n');
          break;
        }

        console.log(`\n  Comprobando actualizaciones de ${boeUrls.length} norma(s)...\n`);
        let updated = 0;
        let skipped = 0;

        for (const url of boeUrls) {
          try {
            const result = await ingestion.ingestFromBoeUrl(url, { force: true });
            if (result.status === 'SKIPPED') {
              skipped++;
            } else {
              updated++;
              console.log(`  Actualizado: ${result.documentId} (${result.chunksCreated} chunks)`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  Error actualizando ${url}: ${msg}`);
          }
        }

        console.log(`\n  Resultado: ${updated} actualizado(s), ${skipped} sin cambios.\n`);
        break;
      }

      case 'reset': {
        if (!hasFlag('--confirm')) {
          console.error('  ⚠ Esto eliminará TODOS los documentos, chunks y embeddings.');
          console.error('  Añade --confirm para confirmar: npm run manage reset --confirm');
          process.exit(1);
        }
        const all = await docs.findAll();
        for (const d of all) {
          await docs.deleteDocument(d.id);
          console.log(`  Eliminado: ${d.officialId}`);
        }
        console.log(`\n  ${all.length} documento(s) eliminado(s).\n`);
        break;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n  Error: ${message}\n`);
    process.exit(1);
  }

  await app.close();
}

async function findDocumentByPartialId(
  docs: LegalDocumentsService,
  partialId: string,
): Promise<{ id: string }> {
  const all = await docs.findAll();
  const matches = all.filter((d) => d.id.startsWith(partialId));
  if (matches.length === 0) {
    throw new Error(`No se encontró documento con ID que empiece por "${partialId}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `ID ambiguo "${partialId}": coincide con ${matches.length} documentos. Sé más específico.`,
    );
  }
  return matches[0];
}

function printIngestResult(result: IngestResult) {
  if (result.status === 'SKIPPED') {
    console.log('\n  === Sin cambios ===');
    console.log(`  ${result.skippedReason}`);
    console.log(`  Documento: ${result.documentId}`);
    console.log('  No se ha re-procesado (ahorro de embeddings).');
    console.log('  Usa --force para forzar la re-ingestión.\n');
    return;
  }
  console.log('\n  === Ingestión completada ===');
  console.log(`  Documento:  ${result.documentId}`);
  console.log(`  Secciones:  ${result.sectionsCreated}`);
  console.log(`  Chunks:     ${result.chunksCreated}`);
  console.log();
}

main();
