import { Injectable, Logger } from '@nestjs/common';
import { HusseConfigDto, HusseFetchDto, HusseImportDto, HusseLoginDto } from './husse.dto';
import { HUSSE_BASE_URL, HUSSE_LOGIN_URL, HUSSE_PRODUCT_URLS } from './husse.constants';
import { parseProductsFromPages, ScrapedProduct } from './husse.parser';
import { PrismaService } from '../prisma/prisma.service';
import { SecureConfigService } from '../common/secure-config.service';

/**
 * Service minimaliste pour interagir avec l'extranet Husse en gardant un cookie de session en mémoire.
 * Pas de dépendance externe : on récupère les Set-Cookie de la page de login
 * puis on les renvoie sur les requêtes suivantes.
 */
@Injectable()
export class HusseService {
  private readonly logger = new Logger(HusseService.name);
  private readonly allowedBaseOrigin = new URL(HUSSE_BASE_URL).origin;
  private readonly loginUrl = HUSSE_LOGIN_URL;
  private cookieHeader: string | null = null;
  private config: { username: string; password: string } | null = null;
  private allowedOrigin: string | null = null;

  constructor(private readonly prisma: PrismaService, private readonly secureConfig: SecureConfigService) {}

  async login(payload: HusseLoginDto): Promise<void> {
    await this.performLogin(payload.username, payload.password, payload.baseUrl);
  }

  async fetchPages(dto: HusseFetchDto): Promise<{ pages: { url: string; html: string }[]; encounteredLoginPage: boolean }> {
    if (!this.cookieHeader) {
      throw new Error('Session Husse manquante : appelez /husse/login avant /husse/fetch');
    }
    if (!this.allowedOrigin) {
      throw new Error('Origine Husse inconnue : reconnectez-vous pour rafraîchir le cookie.');
    }

    const pages: { url: string; html: string }[] = [];
    let encounteredLoginPage = false;

    for (const url of dto.urls) {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Seules les URLs http(s) sont autorisées');
      }
      if (parsed.origin !== this.allowedOrigin) {
        throw new Error(`URL non autorisée : ${parsed.origin} (attendu ${this.allowedOrigin})`);
      }

      const response = await fetch(url, {
        headers: {
          Cookie: this.cookieHeader,
        },
      });

      if (!response.ok) {
        throw new Error(`Erreur Husse ${url}: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      pages.push({ url, html });

      if (this.looksLikeLogin(html)) {
        encounteredLoginPage = true;
      }
    }

    return { pages, encounteredLoginPage };
  }

  async importProducts(dto: HusseImportDto) {
    const credentials = await this.resolveCredentials(dto);
    await this.performLogin(credentials.username, credentials.password, this.loginUrl);

    const { pages, encounteredLoginPage: loginPageOnFetch } = await this.fetchPages({
      urls: [...HUSSE_PRODUCT_URLS],
    });
    const scraped = parseProductsFromPages(pages.map((page) => page.html));
    const encounteredLoginPage = scraped.encounteredLoginPage || loginPageOnFetch;

    const summary = await this.upsertProducts(scraped.products);

    return {
      ...summary,
      encounteredLoginPage,
    };
  }

  sessionStatus() {
    return { hasCookie: !!this.cookieHeader };
  }

  clearCookie() {
    this.cookieHeader = null;
    this.allowedOrigin = null;
  }

  setConfig(dto: HusseConfigDto) {
    if (!dto.username || !dto.password) {
      throw new Error('username et password sont requis');
    }
    this.config = { username: dto.username, password: dto.password };
    this.secureConfig.save('husse', dto).catch((err) => this.logger.warn(`Impossible de persister la config Husse: ${err}`));
    this.logger.log('Configuration Husse sauvegardée');
  }

  async getConfig() {
    if (!this.config) {
      await this.loadFromSecureStore();
    }
    return { hasCredentials: !!this.config };
  }

  private async resolveCredentials(dto?: HusseImportDto) {
    if (dto?.username && dto?.password) {
      return { username: dto.username, password: dto.password };
    }
    if (!this.config) {
      await this.loadFromSecureStore();
    }
    if (!this.config) {
      throw new Error('Identifiants Husse manquants. Renseignez-les dans les réglages.');
    }
    return this.config;
  }

  private async performLogin(username: string, password: string, baseUrl?: string) {
    const targetUrl = this.resolveBaseUrl(baseUrl);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        co_email: username,
        co_pass: password,
        rester_connecte: '1',
      }),
      redirect: 'manual',
    });

    if (!response.ok && response.status !== 302) {
      const text = await response.text();
      throw new Error(`Login Husse échoué: ${response.status} ${response.statusText} – ${text.slice(0, 200)}`);
    }

    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length === 0) {
      const fallback = response.headers.get('set-cookie');
      if (fallback) setCookie.push(fallback);
    }

    if (setCookie.length === 0) {
      throw new Error('Login Husse: aucun cookie reçu');
    }

    this.cookieHeader = this.buildCookieHeader(setCookie);
    this.allowedOrigin = this.allowedBaseOrigin;
    this.logger.log('Cookie Husse mis à jour');
  }

  private async upsertProducts(products: ScrapedProduct[]) {
    const prisma = this.prisma.client();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const product of products) {
      const sku = product.reference.trim();
      const name = product.name.trim();
      if (!sku || !name) {
        skipped += 1;
        continue;
      }

      const description = this.buildDescription(product);
      const price = this.parsePrice(product.priceLabel);
      const familyId = await this.ensureFamily(product.classification?.global);
      const subFamilyId = await this.ensureSubFamily(familyId, product.classification?.group);
      const existing = await prisma.product.findUnique({ where: { sku } });

      if (existing) {
        await prisma.product.update({
          where: { sku },
          data: {
            name,
            description,
            price: price ?? Number(existing.price),
            isActive: true,
            familyId,
            subFamilyId,
          },
        });
        updated += 1;
      } else {
        await prisma.product.create({
          data: {
            sku,
            name,
            description,
            price: price ?? 0,
            isActive: true,
            familyId,
            subFamilyId,
          },
        });
        created += 1;
      }
    }

    this.logger.log(`Import Husse: ${products.length} produits parsés, ${created} créés, ${updated} mis à jour, ${skipped} ignorés.`);

    return { total: products.length, created, updated, skipped };
  }

  private buildCookieHeader(cookies: string[]): string {
    return cookies
      .map((raw) => raw.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }

  private parsePrice(raw?: string | null): number | null {
    if (!raw) return null;
    const normalised = raw.replace(/\s+/g, '').replace(',', '.');
    const match = normalised.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number.parseFloat(match[0]);
    return Number.isFinite(value) ? value : null;
  }

  private buildDescription(product: ScrapedProduct): string | null {
    const parts = [
      product.classification?.global?.trim(),
      product.classification?.group?.trim(),
      product.unitLabel?.trim(),
    ].filter(Boolean);
    if (parts.length === 0) return null;
    return parts.join(' / ');
  }

  private async ensureFamily(name?: string | null) {
    const value = name?.trim();
    if (!value) return null;
    const prisma = this.prisma.client();
    const existing = await prisma.family.findUnique({ where: { name: value } });
    if (existing) return existing.id;
    const created = await prisma.family.create({ data: { name: value } });
    return created.id;
  }

  private async ensureSubFamily(familyId: number | null, name?: string | null) {
    const value = name?.trim();
    if (!familyId || !value) return null;
    const prisma = this.prisma.client();
    const existing = await prisma.subFamily.findUnique({ where: { familyId_name: { familyId, name: value } } });
    if (existing) return existing.id;
    const created = await prisma.subFamily.create({ data: { name: value, familyId } });
    return created.id;
  }

  private async loadFromSecureStore() {
    const stored = await this.secureConfig.load<{ username?: string; password?: string }>('husse');
    if (stored?.username && stored?.password) {
      this.config = { username: stored.username, password: stored.password };
      this.logger.log('Configuration Husse chargée depuis le coffre sécurisé.');
    } else {
      this.config = null;
    }
  }

  private looksLikeLogin(body: string): boolean {
    const lower = body.toLowerCase();
    return lower.includes('co_email') || lower.includes('co_pass') || lower.includes('connexion') || lower.includes('login');
  }

  private resolveBaseUrl(baseUrl?: string) {
    const target = baseUrl?.trim() || this.loginUrl;
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error('baseUrl invalide');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('baseUrl doit être http(s)');
    }
    if (parsed.origin !== this.allowedBaseOrigin) {
      throw new Error(`URL Husse non autorisée (${parsed.origin}). Domaine attendu : ${this.allowedBaseOrigin}`);
    }
    return parsed.toString();
  }
}
