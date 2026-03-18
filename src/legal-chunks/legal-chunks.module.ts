import { Module } from '@nestjs/common';
import { LegalChunksService } from './legal-chunks.service';

@Module({
  providers: [LegalChunksService],
  exports: [LegalChunksService],
})
export class LegalChunksModule {}
