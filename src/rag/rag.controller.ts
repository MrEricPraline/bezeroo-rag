import { Controller, Post, Body } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagQueryDto } from './dto/rag-query.dto';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('query')
  async query(@Body() dto: RagQueryDto) {
    return this.ragService.query(dto.question, dto.maxChunks);
  }
}
