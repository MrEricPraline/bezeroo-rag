import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { LegalDocumentsModule } from '../legal-documents/legal-documents.module';
import { LegalChunksModule } from '../legal-chunks/legal-chunks.module';
import { OpenaiModule } from '../openai/openai.module';

@Module({
  imports: [LegalDocumentsModule, LegalChunksModule, OpenaiModule],
  providers: [IngestionService],
  controllers: [IngestionController],
  exports: [IngestionService],
})
export class IngestionModule {}
