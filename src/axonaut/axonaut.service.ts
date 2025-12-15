import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AxonautConfigDto,
  AxonautClearPendingInvoicesDto,
  AxonautLookupDto,
  AxonautMarkInvoicesImportedDto,
  AxonautSyncStockDto,
  AxonautSyncInvoicesDto,
  AxonautTestRequestDto,
  AxonautUpdateStockDto,
} from './axonaut.dto';
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

export type AxonautInvoiceSummary = {
  id?: string | number;
  number?: string;
  date?: string;
  customerName?: string;
  status?: string;
  total?: number;
  raw?: unknown;
};

export type AxonautInvoiceLine = {
  reference: string;
  description?: string;
  quantity: number;
  axonautProductId?: number;
  axonautProductCode?: string;
  axonautProductName?: string;
  raw?: unknown;
};

type AxonautInvoiceSyncState = {
  lastSyncAt?: string;
  blockedUntil?: string;
  invoices?: Array<{
    id: string;
    number?: string;
    date?: string;
    customerName?: string;
    status?: string;
    total?: number;
  }>;
};

type AxonautSyncedInvoiceSummary = NonNullable<AxonautInvoiceSyncState['invoices']>[number];

@Injectable()
export class AxonautService {
  private readonly logger = new Logger(AxonautService.name);
  private config: ResolvedConfig | null = null;
  private readonly invoicesSyncKey = 'axonaut_invoice_sync_v1';

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

  async syncStock(dto: AxonautSyncStockDto) {
    if (!Array.isArray(dto.productIds) || dto.productIds.length === 0) {
      throw new Error('productIds est requis (tableau non vide)');
    }

    const uniqueIds = Array.from(
      new Set(
        dto.productIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    if (uniqueIds.length === 0) {
      throw new Error('productIds doit contenir au moins un entier positif');
    }

    const prisma = this.prisma.client();
    const products = await prisma.product.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, sku: true, name: true, axonautProductId: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const missing = uniqueIds.filter((id) => !productById.has(id));
    const results: Array<{
      productId: number;
      sku?: string;
      name?: string;
      axonautProductId?: number | null;
      stock?: number;
      ok: boolean;
      skipped?: boolean;
      error?: string;
      axonaut?: unknown;
    }> = [];

    let updated = 0;
    let skipped = 0;

    for (const productId of uniqueIds) {
      const product = productById.get(productId);
      if (!product) {
        skipped += 1;
        results.push({ productId, ok: false, skipped: true, error: 'Produit introuvable' });
        continue;
      }
      if (!product.axonautProductId) {
        skipped += 1;
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          axonautProductId: product.axonautProductId,
          ok: false,
          skipped: true,
          error: 'Produit non lié à Axonaut (axonautProductId manquant)',
        });
        continue;
      }

      const stock = await this.getCurrentStock(productId);
      if (dto.dryRun) {
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          axonautProductId: product.axonautProductId,
          stock,
          ok: true,
          axonaut: { dryRun: true },
        });
        continue;
      }

      try {
        const response = await this.updateStock({
          productId: String(product.axonautProductId),
          quantity: stock,
          reason: dto.reason ?? 'Petflow sync',
        });
        updated += 1;
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          axonautProductId: product.axonautProductId,
          stock,
          ok: true,
          axonaut: response.body,
        });
      } catch (err) {
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          axonautProductId: product.axonautProductId,
          stock,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      requested: uniqueIds.length,
      found: products.length,
      missing,
      updated,
      skipped,
      results,
    };
  }

  async listInvoices(opts?: { limit?: number; from?: string; to?: string; strict?: boolean }) {
    const config = await this.ensureConfig();

    const invoicesUrl = '/api/v2/invoices';
    const baseUrl = this.normalize(config.baseUrl, invoicesUrl);
    const headers = { userApiKey: config.apiKey };
    const strict = opts?.strict === true;
    const fromDate = this.parseOptionalDate(opts?.from);
    const fromTime = fromDate ? fromDate.getTime() : undefined;

    const metaPayload = await this.safeJsonFetch(baseUrl, headers, { strict });
    const metaBlock = this.extractMeta(metaPayload);

    let pages = metaBlock.pages;
    if (!pages && metaBlock.total && metaBlock.perPage) {
      pages = Math.max(1, Math.ceil(metaBlock.total / metaBlock.perPage));
    }
    if (!pages) pages = 1;

    const invoices: AxonautInvoiceSummary[] = [];
    for (let page = 1; page <= pages; page++) {
      const url = this.withPage(baseUrl, page);
      const pageHeaders = { ...headers, page: String(page) };
      const data = await this.safeJsonFetch(url, pageHeaders, { strict });
      const items = this.extractProducts(data);
      if (items.length === 0) break;
      const pageInvoices: AxonautInvoiceSummary[] = [];
      for (const raw of items) {
        const invoice = this.toAxonautInvoiceSummary(raw);
        if (invoice) {
          invoices.push(invoice);
          pageInvoices.push(invoice);
        }
      }

      if (fromTime !== undefined && pageInvoices.length > 0) {
        const pageDates = pageInvoices
          .map((inv) => (inv.date ? new Date(inv.date) : null))
          .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
        if (pageDates.length === pageInvoices.length) {
          const pageOldest = pageDates.reduce((min, d) => Math.min(min, d.getTime()), Number.POSITIVE_INFINITY);
          if (Number.isFinite(pageOldest) && pageOldest < fromTime) {
            break;
          }
        }
      }
    }

    const filtered = this.filterInvoicesByDate(invoices, opts?.from, opts?.to);
    filtered.sort((a, b) => this.compareDateDesc(a.date, b.date));

    const limit = opts?.limit && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : undefined;
    const sliced = limit ? filtered.slice(0, limit) : filtered;

    return {
      total: metaBlock.total,
      pages,
      perPage: metaBlock.perPage,
      fetched: invoices.length,
      returned: sliced.length,
      invoices: sliced,
    };
  }

  async getInvoiceLines(invoiceId: string) {
    const trimmed = (invoiceId ?? '').trim();
    if (!trimmed) throw new Error('invoiceId requis');

    const config = await this.ensureConfig();
    const url = this.normalize(config.baseUrl, `/api/v2/invoices/${encodeURIComponent(trimmed)}`);

    const response = await fetch(url, { headers: { userApiKey: config.apiKey } });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Axonaut invoice fetch failed: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`);
    }

    let payload: any;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    const invoiceObject = payload && typeof payload === 'object' && 'data' in payload ? (payload as any).data : payload;
    const invoiceSource =
      invoiceObject && typeof invoiceObject === 'object' && 'invoice' in invoiceObject ? (invoiceObject as any).invoice : invoiceObject;

    const invoice =
      this.toAxonautInvoiceSummary(invoiceSource) ??
      ({ id: trimmed, raw: invoiceSource } satisfies AxonautInvoiceSummary);

    const linesSource =
      invoiceObject && typeof invoiceObject === 'object' && 'invoice' in invoiceObject ? invoiceObject : invoiceSource;
    const rawLines = this.extractInvoiceLines(linesSource);
    const lines: AxonautInvoiceLine[] = [];
    for (const raw of rawLines) {
      const line = this.toAxonautInvoiceLine(raw);
      if (line) lines.push(line);
    }

    return { invoice, lines };
  }

  async syncInvoices(dto?: AxonautSyncInvoicesDto) {
    const previous = await this.loadInvoiceSyncState();
    const now = new Date();
    const lastSyncAtBefore = previous.lastSyncAt ?? null;
    const blockedUntil = this.parseOptionalDate(previous.blockedUntil);
    const force = dto?.force === true;

    if (blockedUntil && now.getTime() < blockedUntil.getTime()) {
      return {
        ok: true,
        skipped: true,
        reason: 'QUOTA',
        blockedUntil: blockedUntil.toISOString(),
        lastSyncAtBefore,
        lastSyncAtAfter: previous.lastSyncAt ?? null,
        fetched: 0,
        added: 0,
        updated: 0,
        pending: previous.invoices?.length ?? 0,
        invoices: previous.invoices ?? [],
      };
    }

    const lastSyncDate = this.parseOptionalDate(previous.lastSyncAt);
    const minIntervalMinutes = 30;
    if (!force && lastSyncDate) {
      const diffMs = now.getTime() - lastSyncDate.getTime();
      if (diffMs >= 0 && diffMs < minIntervalMinutes * 60 * 1000) {
        return {
          ok: true,
          skipped: true,
          reason: 'TOO_RECENT',
          lastSyncAtBefore,
          lastSyncAtAfter: previous.lastSyncAt ?? null,
          fetched: 0,
          added: 0,
          updated: 0,
          pending: previous.invoices?.length ?? 0,
          invoices: previous.invoices ?? [],
        };
      }
    }

    const lookbackDaysRaw = dto?.lookbackDays;
    const lookbackDays =
      typeof lookbackDaysRaw === 'number' && Number.isFinite(lookbackDaysRaw)
        ? Math.max(1, Math.min(365, Math.floor(lookbackDaysRaw)))
        : 30;

    const minFromDate = new Date(Date.UTC(2025, 11, 1, 0, 0, 0, 0)); // 1er décembre 2025 (UTC)
    const candidateFromDate = lastSyncDate ?? new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const fromDate = candidateFromDate.getTime() < minFromDate.getTime() ? minFromDate : candidateFromDate;

    let fetched: AxonautInvoiceSummary[] = [];
    try {
      const catalog = await this.listInvoices({ from: fromDate.toISOString(), to: now.toISOString(), strict: true });
      fetched = catalog.invoices ?? [];
    } catch (err: any) {
      if (err && typeof err === 'object' && (err as any).status === 429) {
        const next = new Date(now);
        next.setHours(24, 10, 0, 0); // prochain jour 00:10 (approx. reset quota)
        const nextState: AxonautInvoiceSyncState = {
          lastSyncAt: previous.lastSyncAt,
          blockedUntil: next.toISOString(),
          invoices: previous.invoices ?? [],
        };
        await this.saveInvoiceSyncState(nextState);
        return {
          ok: true,
          skipped: true,
          reason: 'QUOTA',
          blockedUntil: nextState.blockedUntil,
          lastSyncAtBefore,
          lastSyncAtAfter: previous.lastSyncAt ?? null,
          fetched: 0,
          added: 0,
          updated: 0,
          pending: nextState.invoices?.length ?? 0,
          invoices: nextState.invoices ?? [],
        };
      }
      throw err;
    }

    const byId = new Map<string, AxonautSyncedInvoiceSummary>();
    for (const inv of previous.invoices ?? []) {
      if (inv?.id?.trim()) byId.set(inv.id.trim(), inv);
    }

    let added = 0;
    let updated = 0;

    for (const inv of fetched) {
      const id = inv?.id !== undefined && inv?.id !== null ? String(inv.id).trim() : '';
      if (!id) continue;

      const next = {
        id,
        number: inv.number,
        date: inv.date,
        customerName: inv.customerName,
        status: inv.status,
        total: inv.total,
      };

      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, next);
        added += 1;
        continue;
      }

      const changed =
        prev.number !== next.number ||
        prev.date !== next.date ||
        prev.customerName !== next.customerName ||
        prev.status !== next.status ||
        prev.total !== next.total;

      if (changed) {
        byId.set(id, { ...prev, ...next });
        updated += 1;
      }
    }

    const invoices = Array.from(byId.values()).sort((a, b) => this.compareDateDesc(a.date, b.date));
    const nextState: AxonautInvoiceSyncState = { lastSyncAt: now.toISOString(), blockedUntil: undefined, invoices };
    await this.saveInvoiceSyncState(nextState);

    return {
      ok: true,
      lastSyncAtBefore,
      lastSyncAtAfter: nextState.lastSyncAt,
      fetched: fetched.length,
      added,
      updated,
      pending: invoices.length,
      invoices,
    };
  }

  async getPendingInvoices() {
    const state = await this.loadInvoiceSyncState();
    const now = new Date();
    const blockedUntil = this.parseOptionalDate(state.blockedUntil);
    const effectiveBlockedUntil =
      blockedUntil && now.getTime() < blockedUntil.getTime() ? blockedUntil.toISOString() : null;
    return {
      lastSyncAt: state.lastSyncAt ?? null,
      blockedUntil: effectiveBlockedUntil,
      pending: state.invoices?.length ?? 0,
      invoices: state.invoices ?? [],
    };
  }

  async clearPendingInvoices(dto?: AxonautClearPendingInvoicesDto) {
    const previous = await this.loadInvoiceSyncState();
    const now = new Date();
    const cleared = previous.invoices?.length ?? 0;
    const advanceLastSyncAt = dto?.advanceLastSyncAt !== false;
    const nextLastSyncAt = advanceLastSyncAt ? now.toISOString() : previous.lastSyncAt;

    const nextState: AxonautInvoiceSyncState = {
      lastSyncAt: nextLastSyncAt,
      blockedUntil: previous.blockedUntil,
      invoices: [],
    };
    await this.saveInvoiceSyncState(nextState);

    const blockedUntil = this.parseOptionalDate(nextState.blockedUntil);
    const effectiveBlockedUntil =
      blockedUntil && now.getTime() < blockedUntil.getTime() ? blockedUntil.toISOString() : null;

    return {
      ok: true,
      cleared,
      lastSyncAtAfter: nextState.lastSyncAt ?? null,
      blockedUntil: effectiveBlockedUntil,
      pending: 0,
      invoices: [],
    };
  }

  async markInvoicesImported(dto: AxonautMarkInvoicesImportedDto) {
    const ids = Array.isArray(dto?.invoiceIds)
      ? dto.invoiceIds.map((id) => String(id).trim()).filter((id) => id.length > 0)
      : [];
    if (ids.length === 0) {
      throw new Error('invoiceIds est requis (tableau non vide)');
    }

    const state = await this.loadInvoiceSyncState();
    const before = state.invoices ?? [];
    const idSet = new Set(ids);
    const after = before.filter((inv) => !idSet.has(inv.id));
    const removed = before.length - after.length;

    const nextState: AxonautInvoiceSyncState = { lastSyncAt: state.lastSyncAt, blockedUntil: state.blockedUntil, invoices: after };
    await this.saveInvoiceSyncState(nextState);

    return { ok: true, removed, remaining: after.length };
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

  private async safeJsonFetch(url: string, headers: Record<string, string>, options?: { strict?: boolean }) {
    const strict = options?.strict === true;
    try {
      const response = await fetch(url, { headers });
      const text = await response.text();
      let parsed: any;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }

      if (response.status === 429) {
        const err = new Error(`Axonaut rate limited (429) for ${url}`) as any;
        err.status = 429;
        err.statusText = response.statusText;
        err.url = url;
        err.body = parsed;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) err.retryAfter = retryAfter;
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        if (rateLimitReset) err.rateLimitReset = rateLimitReset;
        throw err;
      }

      if (strict && response.status === 401) {
        const err = new Error(`Axonaut request unauthorized (401) for ${url}`) as any;
        err.status = 401;
        err.statusText = response.statusText;
        err.url = url;
        err.body = parsed;
        throw err;
      }

      if (strict && !response.ok) {
        const isMetaRequest = !Object.prototype.hasOwnProperty.call(headers, 'page');
        if (response.status === 403 && isMetaRequest) {
          return parsed;
        }
        const err = new Error(`Axonaut request failed (${response.status}) for ${url}`) as any;
        err.status = response.status;
        err.statusText = response.statusText;
        err.url = url;
        err.body = parsed;
        throw err;
      }

      return parsed;
    } catch (err) {
      if (err && typeof err === 'object' && (err as any).status === 429) {
        throw err;
      }
      if (strict) {
        throw err;
      }
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

  private toAxonautInvoiceSummary(raw: any): AxonautInvoiceSummary | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = this.extractId(raw);
    const number = this.extractString(raw, ['number', 'invoice_number', 'invoiceNumber', 'reference', 'ref', 'code']);
    const date = this.extractDateString(raw, ['date', 'invoice_date', 'invoiceDate', 'issued_at', 'issuedAt', 'created_at', 'createdAt']);
    const status = this.extractString(raw, ['status', 'state']);
    const customerName =
      this.extractString(raw, ['company_name', 'customer_name', 'client_name', 'customer']) ??
      this.extractString(raw?.company, ['name']) ??
      this.extractString(raw?.client, ['name']) ??
      this.extractString(raw?.customer, ['name']);
    const total = this.extractNumber(raw, ['total', 'amount_total', 'total_amount', 'amount', 'amount_ht', 'total_ht', 'totalHt']);

    if (!id) return null;
    return { id, number, date, status, customerName, total, raw };
  }

  private extractDateString(obj: any, candidates: string[]): string | undefined {
    for (const key of candidates) {
      const raw = obj?.[key];
      if (raw === undefined || raw === null) continue;
      if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString();
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) return d.toISOString();
        return trimmed;
      }
    }
    return undefined;
  }

  private extractInvoiceLines(invoice: any): any[] {
    if (!invoice || typeof invoice !== 'object') return [];
    const candidates = [
      (invoice as any).lines,
      (invoice as any).invoice_lines,
      (invoice as any).invoiceLines,
      (invoice as any).line_items,
      (invoice as any).lineItems,
      (invoice as any).items,
      (invoice as any).products,
      (invoice as any).rows,
      (invoice as any).details,
    ];

    for (const value of candidates) {
      if (Array.isArray(value)) return value;
    }

    if ((invoice as any).data && typeof (invoice as any).data === 'object') {
      return this.extractInvoiceLines((invoice as any).data);
    }

    return [];
  }

  private toAxonautInvoiceLine(raw: any): AxonautInvoiceLine | null {
    if (!raw || typeof raw !== 'object') return null;
    const quantityRaw = this.extractNumber(raw, ['quantity', 'qty', 'qte', 'quantite']);
    const quantity = Number.isFinite(quantityRaw) ? Math.round(quantityRaw as number) : 0;

    const axonautProductId = this.toInt(
      (raw as any).product_id ??
        (raw as any).productId ??
        (raw as any).id_product ??
        (typeof (raw as any).product === 'number' ? (raw as any).product : undefined) ??
        (raw as any).product?.id,
    );

    const axonautProductCode =
      this.extractString(raw, ['product_code', 'productCode', 'code', 'reference', 'sku', 'ref']) ??
      this.extractString((raw as any).product, ['product_code', 'productCode', 'code', 'reference', 'sku', 'ref']);
    const axonautProductName =
      this.extractString(raw, ['product_name', 'productName', 'name', 'label', 'title']) ??
      this.extractString((raw as any).product, ['name', 'label', 'title']);
    const description =
      this.extractString(raw, ['description', 'label', 'name', 'title']) ??
      this.extractString((raw as any).product, ['name', 'label', 'title']);

    const reference = axonautProductCode?.trim() || (axonautProductId ? String(axonautProductId) : 'UNKNOWN');
    return {
      reference,
      description: description?.trim() || undefined,
      quantity,
      axonautProductId: axonautProductId ?? undefined,
      axonautProductCode: axonautProductCode ?? undefined,
      axonautProductName: axonautProductName ?? undefined,
      raw,
    };
  }

  private filterInvoicesByDate(invoices: AxonautInvoiceSummary[], from?: string, to?: string): AxonautInvoiceSummary[] {
    const fromDate = this.parseOptionalDate(from);
    const toDate = this.parseOptionalDate(to);
    if (!fromDate && !toDate) return invoices;

    const fromTime = fromDate ? fromDate.getTime() : undefined;
    const toTime = toDate ? toDate.getTime() : undefined;

    return invoices.filter((invoice) => {
      const d = invoice.date ? new Date(invoice.date) : null;
      if (!d || isNaN(d.getTime())) return true;
      const t = d.getTime();
      if (fromTime !== undefined && t < fromTime) return false;
      if (toTime !== undefined && t > toTime) return false;
      return true;
    });
  }

  private parseOptionalDate(input?: string): Date | null {
    const trimmed = input?.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  private compareDateDesc(a?: string, b?: string): number {
    const da = a ? new Date(a) : null;
    const db = b ? new Date(b) : null;
    const ta = da && !isNaN(da.getTime()) ? da.getTime() : 0;
    const tb = db && !isNaN(db.getTime()) ? db.getTime() : 0;
    return tb - ta;
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

  private async getCurrentStock(productId: number): Promise<number> {
    const prisma = this.prisma.client();
    const target = new Date();

    const lastInventory = await prisma.inventory.findFirst({
      where: { productId, createdAt: { lte: target } },
      orderBy: { createdAt: 'desc' },
    });

    const baseQuantity = lastInventory?.quantity ?? 0;
    const fromDate = lastInventory?.createdAt;

    const movementsSum = await prisma.stockMovement.aggregate({
      _sum: { quantityDelta: true },
      where: {
        productId,
        createdAt: fromDate
          ? {
              gt: fromDate,
              lte: target,
            }
          : {
              lte: target,
            },
      },
    });

    return baseQuantity + (movementsSum._sum.quantityDelta ?? 0);
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

  private async loadInvoiceSyncState(): Promise<AxonautInvoiceSyncState> {
    const stored = await this.secureConfig.load<AxonautInvoiceSyncState>(this.invoicesSyncKey);
    if (!stored || typeof stored !== 'object') return {};
    const invoices = Array.isArray(stored.invoices)
      ? stored.invoices
          .map((inv) => ({
            id: String(inv?.id ?? '').trim(),
            number: inv?.number,
            date: inv?.date,
            customerName: inv?.customerName,
            status: inv?.status,
            total: typeof inv?.total === 'number' && Number.isFinite(inv.total) ? inv.total : undefined,
          }))
          .filter((inv) => inv.id.length > 0)
      : undefined;

    return {
      lastSyncAt: typeof stored.lastSyncAt === 'string' ? stored.lastSyncAt : undefined,
      blockedUntil: typeof stored.blockedUntil === 'string' ? stored.blockedUntil : undefined,
      invoices,
    };
  }

  private async saveInvoiceSyncState(state: AxonautInvoiceSyncState) {
    await this.secureConfig.save(this.invoicesSyncKey, state);
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
