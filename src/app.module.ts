import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OpenaiModule } from './openai/openai.module';
import { LegalDocumentsModule } from './legal-documents/legal-documents.module';
import { LegalChunksModule } from './legal-chunks/legal-chunks.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RagModule } from './rag/rag.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    HealthModule,
    OpenaiModule,
    LegalDocumentsModule,
    LegalChunksModule,
    IngestionModule,
    RagModule,
  ],
})
export class AppModule {}
