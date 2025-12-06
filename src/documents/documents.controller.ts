import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentType } from '../common/enums/document-type.enum';
import { IngestDocumentDto, ParseDocumentDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import type { Express } from 'express';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('parse')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype?.includes('pdf')) {
          cb(new BadRequestException('Seuls les PDF sont acceptés'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async parse(@UploadedFile() file: Express.Multer.File, @Body() body: ParseDocumentDto) {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF reçu (clé "file").');
    }
    if (!body?.docType) {
      throw new BadRequestException('docType est requis.');
    }

    const parsed = await this.documentsService.parsePdf(file, body.docType as DocumentType);
    return { lines: parsed };
  }

  @Post('ingest')
  async ingest(@Body() dto: IngestDocumentDto) {
    if (!dto.docType) throw new BadRequestException('docType requis');
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('lines ne peut pas être vide');
    }

    return this.documentsService.ingest(dto);
  }
}
