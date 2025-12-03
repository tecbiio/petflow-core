import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentType } from '../common/enums/document-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { IngestDocumentDto, ParsedLine } from './documents.dto';

type TemplateConfig = {
  lineRegex?: string;
  referenceGroup?: number;
  quantityGroup?: number;
  descriptionGroup?: number;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private templateCache = new Map<DocumentType, TemplateConfig>();

  constructor(private readonly prisma: PrismaService) {}

  async parsePdf(file: Express.Multer.File, docType: DocumentType): Promise<ParsedLine[]> {
    const buffer = file.buffer ?? (file.path ? await fs.promises.readFile(file.path) : null);
    if (!buffer) {
      throw new Error('Impossible de lire le fichier PDF.');
    }

    const extracted = await this.parseViaPython(buffer, file.originalname, docType);
    this.logParsedLines(extracted, docType, file.originalname);
    return extracted;
  }

  async ingest(dto: IngestDocumentDto) {
    const locationId = dto.stockLocationId ?? (await this.getDefaultLocationId());
    if (!locationId) {
      throw new Error('Aucun emplacement de stock par défaut trouvé.');
    }

    const created: Prisma.StockMovementCreateManyInput[] = [];
    const skipped: { reference: string; reason: string }[] = [];

    for (const line of dto.lines) {
      const product = await this.prisma.product.findFirst({
        where: { OR: [{ sku: line.reference }, { name: line.reference }] },
      });

      if (!product) {
        skipped.push({ reference: line.reference, reason: 'Produit introuvable (sku/nom)' });
        continue;
      }

      const delta = this.deltaFromDocType(dto.docType, line.quantity);
      created.push({
        productId: product.id,
        stockLocationId: locationId,
        quantityDelta: delta,
        reason: `import:${dto.docType.toLowerCase()}`,
        sourceDocumentType: dto.docType,
        sourceDocumentId: dto.sourceDocumentId,
      });
    }

    if (created.length > 0) {
      await this.prisma.stockMovement.createMany({ data: created });
    }

    return { created: created.length, skipped };
  }

  private deltaFromDocType(docType: DocumentType, quantity: number) {
    const abs = Math.abs(quantity);
    switch (docType) {
      case DocumentType.FACTURE:
        return -abs;
      case DocumentType.AVOIR:
      case DocumentType.BON_LIVRAISON:
        return abs;
      default:
        return quantity;
    }
  }

  private async getDefaultLocationId(): Promise<number | null> {
    const location = await this.prisma.stockLocation.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    return location?.id ?? null;
  }

  private async loadTemplate(docType: DocumentType): Promise<TemplateConfig | null> {
    if (this.templateCache.has(docType)) {
      return this.templateCache.get(docType) ?? null;
    }
    const dir = process.env.PDF_TEMPLATE_DIR ?? path.resolve(process.cwd(), 'pdf-templates');
    const fileName = `${docType.toLowerCase()}.json`;
    const filePath = path.join(dir, fileName);
    if (!(await this.exists(filePath))) {
      return null;
    }
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const template = JSON.parse(raw) as TemplateConfig;
      this.templateCache.set(docType, template);
      return template;
    } catch (err) {
      this.logger.warn(`Impossible de lire le template ${filePath}: ${err}`);
      return null;
    }
  }

  private async extractWithTemplate(text: string, docType: DocumentType): Promise<ParsedLine[] | null> {
    const template = await this.loadTemplate(docType);
    if (!template) return null;
    const parsed = this.parseWithTemplate(text, template);
    return parsed.length > 0 ? parsed : null;
  }

  private parseWithTemplate(text: string, template: TemplateConfig): ParsedLine[] {
    if (!template.lineRegex) return [];
    const regex = new RegExp(template.lineRegex, 'gmi');
    const results: ParsedLine[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const ref = this.pickGroup(match, template.referenceGroup) ?? 'UNKNOWN';
      const quantityRaw = this.pickGroup(match, template.quantityGroup);
      const desc = this.pickGroup(match, template.descriptionGroup);
      const quantity = quantityRaw ? Number(quantityRaw.replace(',', '.')) : 0;
      results.push({
        reference: ref.trim(),
        description: desc?.trim(),
        quantity: Number.isFinite(quantity) ? quantity : 0,
      });
    }
    return results;
  }

  private async parseViaPython(buffer: Buffer, fileName: string | undefined, docType: DocumentType): Promise<ParsedLine[]> {
    const serviceUrl = process.env.PDF_SERVICE_URL || 'http://localhost:8000/parse';
    const payload = {
      docType,
      fileName: fileName ?? 'upload.pdf',
      fileBase64: buffer.toString('base64'),
    };

    try {
      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Python parser error ${response.status}: ${txt}`);
      }
      const data = (await response.json()) as { lines?: ParsedLine[] };
      return data.lines ?? [];
    } catch (err) {
      this.logger.error(`Appel au service Python échoué: ${err}`);
      return [];
    }
  }

  private pickGroup(match: RegExpExecArray, index?: number): string | undefined {
    if (!index || index < 1) return undefined;
    return match[index];
  }

  private async logParsedLines(lines: ParsedLine[], docType: DocumentType, fileName?: string) {
    try {
      const first = lines.slice(0, 50).map((l) => `${l.reference} | ${l.description ?? ''} | ${l.quantity}`).join('\n');
      const header = `---- Parsed ${lines.length} lines (${docType}) from ${fileName ?? 'upload'} at ${new Date().toISOString()} ----\n`;
      const content = `${header}${first}\n\n`;
      const logPath = path.resolve(process.cwd(), 'tmp', 'parsed-lines.log');
      await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
      await fs.promises.appendFile(logPath, content, 'utf-8');
      this.logger.debug(header.trim());
    } catch (err) {
      this.logger.warn(`Failed to log parsed lines: ${err}`);
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
