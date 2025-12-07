import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AxonautConfigDto, AxonautLookupDto, AxonautTestRequestDto, AxonautUpdateStockDto } from './axonaut.dto';
import { SecureConfigService } from '../common/secure-config.service';
import { PrismaService } from '../prisma/prisma.service';

type AxonautConfig = AxonautConfigDto;
type ResolvedConfig = {
  apiKey: string;
  baseUrl: string;
  updateStockUrlTemplate: string;
  lookupProductsUrlTemplate: string;
};
export type AxonautProduct = {
  id?: string | number;
  code?: string;
  name?: string;
  price?: number;
  taxRate?: number;
  purchasePrice?: number;
  packaging?: string;
  priceVdiHt?: number;
  priceDistributorHt?: number;
  raw?: unknown;
};

@Injectable()
export class AxonautService {
  private readonly logger = new Logger(AxonautService.name);
  private config: ResolvedConfig | null = null;

  constructor(
    private readonly secureConfig: SecureConfigService,
    private readonly prisma: PrismaService,
  ) {}

  setConfig(dto: AxonautConfigDto) {
    if (!dto.apiKey || !dto.apiKey.trim()) {
      throw new Error('apiKey est requise');
    }
    this.config = this.withDefaults(dto);
    this.secureConfig.save('axonaut', { apiKey: dto.apiKey }).catch((err) => {
      this.logger.warn(`Impossible de persister la config Axonaut: ${err}`);
    });
    this.logger.log('Configuration Axonaut mise à jour en mémoire.');
  }

  async getConfig() {
    if (!this.config) {
      await this.loadFromSecureStore();
    }
    return this.config;
  }

  async getPublicConfig() {
    if (!this.config) {
      await this.loadFromSecureStore();
    }
    if (!this.config) return null;
    const { baseUrl, updateStockUrlTemplate, lookupProductsUrlTemplate } = this.config;
    return {
      hasApiKey: true,
      baseUrl,
      updateStockUrlTemplate,
      lookupProductsUrlTemplate,
    };
  }

  async updateStock(dto: AxonautUpdateStockDto) {
    const config = await this.ensureConfig();
    const { baseUrl, apiKey, updateStockUrlTemplate } = config;
    const url = this.interpolate(updateStockUrlTemplate ?? '/api/v2/products/{product_id}/stock', dto.productId);

    const body: Record<string, unknown> = {};
    if (dto.quantity !== undefined) body.quantity = dto.quantity;
    if (dto.quantityDelta !== undefined) body.quantityDelta = dto.quantityDelta;
    if (dto.reason) body.reason = dto.reason;

    const response = await fetch(this.normalize(baseUrl, url), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        userApiKey: apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Axonaut stock update failed: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    return { ok: true, status: response.status, body: json };
  }

  /**
   * Récupère le catalogue Axonaut (pagination, même si la 1re réponse est un 403 avec les meta).
   * On réutilise l'approche de pdf2json : premier appel pour meta (results, results_per_page, pages),
   * puis appels par page en ajoutant le header et le param `page`.
   */
  async fetchProductsCatalog(): Promise<{ products: AxonautProduct[]; total?: number; pages?: number; perPage?: number }> {
    const config = await this.ensureConfig();

    const productsUrl = this.getProductsUrl(config.lookupProductsUrlTemplate ?? '/api/v2/products?reference={reference}');
    const baseUrl = this.normalize(config.baseUrl, productsUrl);
    const headers = { userApiKey: config.apiKey };

    const metaPayload = await this.safeJsonFetch(baseUrl, headers);
    const metaBlock = this.extractMeta(metaPayload);

    let pages = metaBlock.pages;
    if (!pages && metaBlock.total && metaBlock.perPage) {
      pages = Math.max(1, Math.ceil(metaBlock.total / metaBlock.perPage));
    }
    if (!pages) pages = 1;

    const products: AxonautProduct[] = [];
    for (let page = 1; page <= pages; page++) {
      const url = this.withPage(baseUrl, page);
      const pageHeaders = { ...headers, page: String(page) };
      const data = await this.safeJsonFetch(url, pageHeaders);
      const items = this.extractProducts(data);
      for (const raw of items) {
        const product = this.toAxonautProduct(raw);
        if (product) products.push(product);
      }
    }

    this.logger.debug(`Axonaut catalog fetched: ${products.length} products over ${pages} pages (total=${metaBlock.total ?? 'n/a'}).`);
    return { products, total: metaBlock.total, pages, perPage: metaBlock.perPage };
  }

  async lookup(dto: AxonautLookupDto) {
    const config = await this.ensureConfig();
    const { baseUrl, apiKey } = config;
    const lookupTemplate = config.lookupProductsUrlTemplate ?? '/api/v2/products?reference={reference}';
    const results: Record<string, { id?: string | number; raw?: unknown }> = {};

    for (const reference of dto.references) {
      const url = this.interpolate(lookupTemplate, reference);
      const response = await fetch(this.normalize(baseUrl, url), {
        headers: { userApiKey: apiKey },
      });
      const text = await response.text();
      if (!response.ok) {
        results[reference] = { raw: { error: `${response.status} ${response.statusText}`, body: text } };
        continue;
      }
      try {
        const json = text ? JSON.parse(text) : {};
        const id = this.extractId(json);
        results[reference] = { id, raw: json };
      } catch {
        results[reference] = { raw: text };
      }
    }

    return results;
  }

  async testRequest(dto: AxonautTestRequestDto) {
    const config = await this.ensureConfig();
    const method = dto.method ?? 'GET';
    const target = (dto.url ?? dto.path ?? '').trim();
    if (!target) throw new Error('url ou path requis');
    const url = target.startsWith('http') ? target : this.normalize(config.baseUrl, target);
    this.assertSameHost(url, config.baseUrl);
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Seules les requêtes http(s) sont autorisées');
    }
    const headers: Record<string, string> = { userApiKey: config.apiKey };
    const options: RequestInit = { method, headers };
    if (dto.body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(dto.body);
    }

    try {
      const response = await fetch(url, options);
      const text = await response.text();

      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url,
        body: parsed,
      };
    } catch (err) {
      this.logger.warn(`Axonaut testRequest failed for ${url}: ${err}`);
      return {
        ok: false,
        status: -1,
        statusText: 'FETCH_ERROR',
        url,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private async safeJsonFetch(url: string, headers: Record<string, string>) {
    try {
      const response = await fetch(url, { headers });
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        return { raw: text };
      }
    } catch (err) {
      this.logger.warn(`Axonaut fetch failed for ${url}: ${err}`);
      return {};
    }
  }

  private extractMeta(payload: any): { total?: number; perPage?: number; pages?: number } {
    const metaSource = payload && typeof payload === 'object' && 'error' in payload ? (payload as any).error : payload;
    const toNumber = (value: any): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    };
    return {
      total: toNumber(metaSource?.results),
      perPage: toNumber(metaSource?.results_per_page ?? metaSource?.results_perpage),
      pages: toNumber(metaSource?.pages),
    };
  }

  private extractProducts(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (typeof payload === 'object') {
      if (Array.isArray((payload as any).data)) return (payload as any).data;
      if (Array.isArray((payload as any).items)) return (payload as any).items;
    }
    return [];
  }

  private toAxonautProduct(raw: any): AxonautProduct | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = this.extractId(raw);
    const code = this.extractCode(raw);
    const name = this.extractName(raw);
    const price = this.extractPrice(raw);
    const taxRate = this.extractNumber(raw, ['tax_rate', 'taxRate']);
    const purchasePrice = this.extractNumber(raw, ['job_costing', 'purchase_price', 'buy_price', 'prix_achat']);
    const packaging = this.extractString(raw, ['conditionnement', 'packaging', 'condition', 'conditionnement_nom']);
    const priceVdiHt = this.extractNumber(raw, ['tarif_vdi', 'tarif_vdi_ht', 'price_vdi', 'price_vdi_ht']);
    const priceDistributorHt = this.extractNumber(raw, [
      'tarif_distributeur',
      'tarif_distributeur_ht',
      'price_distributor',
      'price_distributeur_ht',
    ]);

    if (!id && !code && !name) return null;
    return { id, code, name, price, taxRate, purchasePrice, packaging, priceVdiHt, priceDistributorHt, raw };
  }

  private extractCode(product: any): string | undefined {
    const candidates = ['product_code', 'code', 'reference', 'ref'];
    for (const key of candidates) {
      const value = product?.[key];
      if (typeof value === 'string' || typeof value === 'number') {
        const str = String(value).trim();
        if (str) return str;
      }
    }
    return undefined;
  }

  private extractName(product: any): string | undefined {
    const candidates = ['name', 'label', 'title'];
    for (const key of candidates) {
      const value = product?.[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  }

  private extractPrice(product: any): number | undefined {
    return this.extractNumber(product, ['price', 'sale_price', 'unit_price', 'amount', 'amount_ht', 'price_ht']);
  }

  private extractNumber(product: any, candidates: string[]): number | undefined {
    for (const key of candidates) {
      const raw = product?.[key];
      if (raw === undefined || raw === null) continue;
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  }

  private extractString(product: any, candidates: string[]): string | undefined {
    for (const key of candidates) {
      const raw = product?.[key];
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  }

  private withPage(url: string, page: number): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('page', String(page));
      return parsed.toString();
    } catch {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}page=${page}`;
    }
  }

  private getProductsUrl(template: string) {
    if (!template) return template;
    if (template.includes('{reference}')) {
      const [base] = template.split('?');
      return base.replace('{reference}', '').replace(/[\?&]$/, '');
    }
    return template;
  }

  private interpolate(template: string, reference: string) {
    return template.replace('{product_id}', encodeURIComponent(reference)).replace('{reference}', encodeURIComponent(reference));
  }

  private async ensureConfig(): Promise<ResolvedConfig> {
    if (!this.config) {
      await this.loadFromSecureStore();
    }
    if (!this.config) {
      throw new Error('Config Axonaut manquante. Appelez /axonaut/config avant d\'utiliser Axonaut.');
    }
    return this.config;
  }

  private withDefaults(dto: AxonautConfigDto): ResolvedConfig {
    const baseUrl = this.sanitizeBaseUrl(dto.baseUrl ?? 'https://axonaut.com');
    const updateStockUrlTemplate = this.sanitizeTemplate(
      dto.updateStockUrlTemplate ?? '/api/v2/products/{product_id}/stock',
      baseUrl,
    );
    const lookupProductsUrlTemplate = this.sanitizeTemplate(
      dto.lookupProductsUrlTemplate ?? '/api/v2/products?reference={reference}',
      baseUrl,
    );
    return {
      apiKey: dto.apiKey,
      baseUrl,
      updateStockUrlTemplate,
      lookupProductsUrlTemplate,
    };
  }

  private sanitizeBaseUrl(input: string): string {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('baseUrl doit être http(s)');
      }
      return parsed.origin;
    } catch (err) {
      throw new Error(`baseUrl invalide: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private sanitizeTemplate(template: string, baseUrl: string) {
    const trimmed = template.trim();
    if (trimmed.startsWith('http')) {
      const parsed = new URL(trimmed);
      this.assertSameHost(parsed.toString(), baseUrl);
      return `${parsed.pathname}${parsed.search}`;
    }
    return trimmed;
  }

  private assertSameHost(target: string, baseUrl: string) {
    const targetUrl = new URL(target);
    const base = new URL(baseUrl);
    if (targetUrl.hostname !== base.hostname) {
      throw new Error(`URL ${targetUrl.hostname} non autorisée (domaine Axonaut attendu: ${base.hostname})`);
    }
  }

  private normalize(base: string, path: string) {
    if (path.startsWith('http')) return path;
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  private async loadFromSecureStore() {
    const stored = await this.secureConfig.load<{ apiKey?: string }>('axonaut');
    if (stored?.apiKey?.trim()) {
      this.config = this.withDefaults({ apiKey: stored.apiKey });
      this.logger.log('Configuration Axonaut chargée depuis le coffre sécurisé.');
    } else {
      this.config = null;
    }
  }

  private extractId(payload: any): string | number | undefined {
    if (!payload) return undefined;
    if (typeof payload === 'object') {
      if ('id' in payload && (typeof payload.id === 'string' || typeof payload.id === 'number')) {
        return payload.id;
      }
      if ('data' in payload && payload.data) {
        const data = (payload as any).data;
        if (typeof data === 'object') {
          if ('id' in data && (typeof data.id === 'string' || typeof data.id === 'number')) {
            return data.id;
          }
          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            if (first && (typeof first.id === 'string' || typeof first.id === 'number')) {
              return first.id;
            }
          }
        }
      }
      if (Array.isArray(payload) && payload.length > 0) {
        const first = payload[0];
        if (first && (typeof first.id === 'string' || typeof first.id === 'number')) {
          return first.id;
        }
      }
    }
    return undefined;
  }

  /**
   * Importe le catalogue Axonaut et met à jour/ajoute les produits locaux (prix HT, TVA, achat, conditionnement, tarifs VDI/distributeur).
   */
  async importProducts() {
    const catalog = await this.fetchProductsCatalog();
    const prisma = this.prisma.client();
    let created = 0;
    let updated = 0;
    let packagingCreated = 0;
    const errors: string[] = [];

    for (const item of catalog.products) {
      try {
        const sku = this.extractCode(item) ?? this.stringify(item.id) ?? undefined;
        const name = this.extractName(item) ?? sku ?? 'Produit Axonaut';
        const axonautId = this.toInt(item.id);
        if (!sku) {
          errors.push(`Produit ignoré (pas de code ni d'id) : ${JSON.stringify(item.raw ?? item)}`);
          continue;
        }
        const packagingResult = item.packaging ? await this.ensurePackaging(item.packaging) : undefined;
        const packagingId = packagingResult?.id;
        if (packagingResult?.created) packagingCreated += 1;
        const where: Prisma.ProductWhereInput = {
          OR: [
            axonautId ? { axonautProductId: axonautId } : undefined,
            { sku },
          ].filter(Boolean) as Prisma.ProductWhereInput[],
        };
        const existing = await prisma.product.findFirst({ where });

        const price = this.toNumber(item.price) ?? 0;
        const productPayload: Prisma.ProductCreateInput = {
          name,
          sku,
          description: null,
          price,
          priceSaleHt: price,
          priceVdiHt: this.toNumber(item.priceVdiHt) ?? 0,
          priceDistributorHt: this.toNumber(item.priceDistributorHt) ?? 0,
          purchasePrice: this.toNumber(item.purchasePrice) ?? 0,
          tvaRate: this.toNumber(item.taxRate) ?? 0,
          isActive: true,
          axonautProductId: axonautId ?? null,
          packaging: packagingId ? { connect: { id: packagingId } } : undefined,
        };

        if (!existing) {
          await prisma.product.create({ data: productPayload });
          created += 1;
          continue;
        }

        const updateData: Prisma.ProductUpdateInput = {};
        if (name && name !== existing.name) updateData.name = name;
        if (sku && sku !== existing.sku) updateData.sku = sku;
        if (axonautId && existing.axonautProductId !== axonautId) updateData.axonautProductId = axonautId;
        updateData.priceSaleHt = price;
        updateData.price = price;
        updateData.priceVdiHt = productPayload.priceVdiHt;
        updateData.priceDistributorHt = productPayload.priceDistributorHt;
        updateData.purchasePrice = productPayload.purchasePrice;
        updateData.tvaRate = productPayload.tvaRate;
        if (packagingId) {
          updateData.packaging = { connect: { id: packagingId } };
        }

        await prisma.product.update({ where: { id: existing.id }, data: updateData });
        updated += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      total: catalog.products.length,
      created,
      updated,
      packagingCreated,
      errors,
    };
  }

  private toNumber(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toInt(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  private stringify(value: any): string | undefined {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str || undefined;
  }

  private async ensurePackaging(name: string): Promise<{ id: number; created: boolean } | undefined> {
    const normalized = name.trim();
    if (!normalized) return undefined;
    const prisma = this.prisma.client();
    const existing = await prisma.packaging.findUnique({ where: { name: normalized } });
    if (existing) return { id: existing.id, created: false };
    const created = await prisma.packaging.create({ data: { name: normalized } });
    return { id: created.id, created: true };
  }
}
