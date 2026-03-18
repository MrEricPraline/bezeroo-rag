import { Module } from '@nestjs/common';
import { LegalDocumentsService } from './legal-documents.service';
import { LegalDocumentsController } from './legal-documents.controller';

@Module({
  providers: [LegalDocumentsService],
  controllers: [LegalDocumentsController],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
