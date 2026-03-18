import {
  Controller, Post, Body, Get, Param,
  UploadedFile, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { IngestDocumentDto, IngestBoeDto } from './dto/ingest-document.dto';
import { PrismaService } from '../database/prisma.service';

@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('file')
  async ingest(@Body() dto: IngestDocumentDto) {
    return this.ingestionService.ingestFromFile(dto.filePath, dto.versionTag, {
      force: dto.force,
    });
  }

  @Post('boe')
  async ingestBoe(@Body() dto: IngestBoeDto) {
    return this.ingestionService.ingestFromBoeUrl(dto.url, {
      force: dto.force,
    });
  }

  @Post('pdf')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @UseInterceptors(FileInterceptor('file'))
  async ingestPdf(@UploadedFile() file: Express.Multer.File) {
    return {
      statusCode: 501,
      message: 'Ingestión de PDF en desarrollo. Usa /ingestion/boe para normativa del BOE.',
    };
  }

  @Get('jobs')
  async listJobs() {
    return this.prisma.ingestionJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    return this.prisma.ingestionJob.findUnique({ where: { id } });
  }
}
