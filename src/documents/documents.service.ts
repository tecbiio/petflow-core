import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import type { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentType } from '../common/enums/document-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { IngestDocumentDto, ParsedLine } from './documents.dto';
import { AxonautProduct, AxonautService } from '../axonaut/axonaut.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly axonautService: AxonautService,
  ) {}

  async parsePdf(file: Express.Multer.File, docType: DocumentType): Promise<ParsedLine[]> {
    const buffer = file.buffer ?? (file.path ? await fs.promises.readFile(file.path) : null);
    if (!buffer) {
      throw new Error('Impossible de lire le fichier PDF.');
    }

    const extracted = await this.parseViaPython(buffer, file.originalname, docType);
    const enriched = await this.enrichLinesWithAxonaut(extracted);
    this.logParsedLines(enriched, docType, file.originalname);
    return enriched;
  }

  async ingest(dto: IngestDocumentDto) {
    const locationId = dto.stockLocationId ?? (await this.getDefaultLocationId());
    if (!locationId) {
      throw new Error('Aucun emplacement de stock par défaut trouvé.');
    }

    const lines = await this.enrichLinesWithAxonaut(dto.lines);
    const createdMovements: Prisma.StockMovementCreateManyInput[] = [];
    const skipped: { reference: string; reason: string }[] = [];
    let productsCreated = 0;
    let productsLinked = 0;

    for (const line of lines) {
      const resolution = await this.resolveProduct(line);

      if (!resolution) {
        skipped.push({
          reference: line.reference,
          reason: 'Produit introuvable (sku/nom) et création impossible',
        });
        continue;
      }

      if (resolution.created) productsCreated += 1;
      if (resolution.linkedAxonaut) productsLinked += 1;

      const delta = this.deltaFromDocType(dto.docType, line.quantity);
      createdMovements.push({
        productId: resolution.product.id,
        stockLocationId: locationId,
        quantityDelta: delta,
        reason: `import:${dto.docType.toLowerCase()}`,
        sourceDocumentType: dto.docType,
        sourceDocumentId: dto.sourceDocumentId,
      });
    }

    if (createdMovements.length > 0) {
      await this.prisma.stockMovement.createMany({ data: createdMovements });
    }

    return { created: createdMovements.length, skipped, productsCreated, productsLinked };
  }

  private async enrichLinesWithAxonaut(lines: ParsedLine[]): Promise<ParsedLine[]> {
    if (!lines || lines.length === 0) return lines;
    const needsLookup = lines.some((line) => !line.axonautProductId);
    if (!needsLookup) return lines;
    const config = await this.axonautService.getConfig();
    if (!config?.lookupProductsUrlTemplate) return lines;

    try {
      const catalog = await this.axonautService.fetchProductsCatalog();
      if (!catalog.products?.length) return lines;
      const index = this.buildCatalogIndex(catalog.products);

      return lines.map((line) => {
        if (line.axonautProductId) return line;
        const key = this.normalizeReference(line.reference);
        if (!key) return line;
        const match = index.get(key);
        if (!match) return line;

        const axonautId = this.toInt(match.id);
        const parsedPrice = match.price !== undefined ? Number(match.price) : undefined;

        return {
          ...line,
          axonautProductId: axonautId ?? line.axonautProductId,
          axonautProductCode: match.code ?? line.axonautProductCode ?? line.reference,
          axonautProductName: match.name ?? line.axonautProductName,
          axonautProductPrice: Number.isFinite(parsedPrice) ? (parsedPrice as number) : line.axonautProductPrice,
        };
      });
    } catch (err) {
      this.logger.warn(`Enrichissement Axonaut ignoré: ${err instanceof Error ? err.message : err}`);
      return lines;
    }
  }

  private buildCatalogIndex(products: AxonautProduct[]): Map<string, AxonautProduct> {
    const index = new Map<string, AxonautProduct>();
    for (const product of products) {
      const code = this.normalizeReference(product.code);
      if (!code) continue;
      if (!index.has(code)) {
        index.set(code, product);
      }
    }
    return index;
  }

  private async resolveProduct(line: ParsedLine): Promise<{ product: Product; created: boolean; linkedAxonaut: boolean } | null> {
    const reference = line.reference?.trim() || line.axonautProductCode?.trim();
    const axonautId = this.toInt(line.axonautProductId);

    let product = await this.findExistingProduct(reference, axonautId);
    let created = false;

    if (!product) {
      product = await this.createProductFromLine(line, axonautId);
      created = !!product;
    }

    if (!product) return null;

    const attach = await this.tryAttachAxonautId(product, axonautId);
    const linkedAxonaut = attach.linked || (created && Boolean(axonautId));
    return { product: attach.product, created, linkedAxonaut };
  }

  private async findExistingProduct(reference?: string, axonautId?: number): Promise<Product | null> {
    if (axonautId) {
      const byAxonaut = await this.prisma.product.findUnique({ where: { axonautProductId: axonautId } });
      if (byAxonaut) return byAxonaut;
    }
    if (!reference) return null;
    return this.prisma.product.findFirst({
      where: { OR: [{ sku: reference }, { name: reference }] },
    });
  }

  private async createProductFromLine(line: ParsedLine, axonautId?: number): Promise<Product | null> {
    const sku = line.reference?.trim() || line.axonautProductCode?.trim();
    const name = this.pickName(line);
    if (!sku) {
      this.logger.warn(`Impossible de créer le produit: référence vide (ligne: ${JSON.stringify(line)})`);
      return null;
    }
    const price = this.pickPrice(line);
    try {
      return await this.prisma.product.create({
        data: {
          name,
          sku,
          description: line.description ?? null,
          price,
          isActive: true,
          axonautProductId: axonautId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Echec de création produit ${sku}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async tryAttachAxonautId(product: Product, axonautId?: number): Promise<{ product: Product; linked: boolean }> {
    if (!axonautId || product.axonautProductId) {
      return { product, linked: false };
    }
    const conflict = await this.prisma.product.findFirst({
      where: { axonautProductId: axonautId, NOT: { id: product.id } },
    });
    if (conflict) {
      this.logger.warn(`Axonaut ID ${axonautId} déjà utilisé par le produit #${conflict.id}, liaison ignorée pour #${product.id}.`);
      return { product, linked: false };
    }
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { axonautProductId: axonautId },
    });
    return { product: updated, linked: true };
  }

  private pickName(line: ParsedLine): string {
    if (line.axonautProductName?.trim()) return line.axonautProductName.trim();
    if (line.description?.trim()) return line.description.trim();
    if (line.reference?.trim()) return line.reference.trim();
    return 'Produit importé';
  }

  private pickPrice(line: ParsedLine): number {
    const candidates = [line.axonautProductPrice];
    for (const value of candidates) {
      if (value === undefined || value === null) continue;
      const parsed = Number(String(value).replace(',', '.'));
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
  }

  private normalizeReference(ref?: string | number | null): string | null {
    if (ref === undefined || ref === null) return null;
    const str = String(ref).trim().toLowerCase();
    return str || null;
  }

  private toInt(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) return parsed;
    }
    return undefined;
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
      const first = lines
        .slice(0, 50)
        .map((l) => {
          const axonaut = l.axonautProductId ? ` | axonaut:${l.axonautProductId}${l.axonautProductName ? ` ${l.axonautProductName}` : ''}` : '';
          return `${l.reference} | ${l.description ?? ''} | ${l.quantity}${axonaut}`;
        })
        .join('\n');
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
