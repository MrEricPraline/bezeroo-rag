import { IsString, IsOptional, IsUrl, IsBoolean } from 'class-validator';

export class IngestDocumentDto {
  @IsString()
  filePath!: string;

  @IsString()
  @IsOptional()
  versionTag?: string;

  @IsBoolean()
  @IsOptional()
  force?: boolean;
}

export class IngestBoeDto {
  @IsUrl()
  url!: string;

  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
