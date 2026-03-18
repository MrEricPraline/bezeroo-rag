import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { Logger } from '@nestjs/common';
import * as path from 'path';

async function main() {
  const logger = new Logger('IngestExample');
  const app = await NestFactory.createApplicationContext(AppModule);

  const ingestionService = app.get(IngestionService);

  const filePath = path.resolve(
    __dirname,
    '../../data/ley-26-2007-responsabilidad-medioambiental.json',
  );

  logger.log(`Ingestando archivo: ${filePath}`);

  try {
    const result = await ingestionService.ingestFromFile(filePath);
    logger.log('Resultado de la ingestión:');
    logger.log(JSON.stringify(result, null, 2));
  } catch (error) {
    logger.error('Error durante la ingestión:', error);
  }

  await app.close();
}

main();
