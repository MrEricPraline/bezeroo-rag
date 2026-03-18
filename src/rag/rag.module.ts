import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { LegalChunksModule } from '../legal-chunks/legal-chunks.module';
import { OpenaiModule } from '../openai/openai.module';

@Module({
  imports: [LegalChunksModule, OpenaiModule],
  providers: [RagService],
  controllers: [RagController],
})
export class RagModule {}
