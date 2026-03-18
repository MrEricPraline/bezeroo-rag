import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class RagQueryDto {
  @IsString()
  question!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxChunks?: number;
}
