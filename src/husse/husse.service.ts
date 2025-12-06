import { Injectable, Logger } from '@nestjs/common';
import { HusseConfigDto, HusseFetchDto, HusseLoginDto } from './husse.dto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Service minimaliste pour interagir avec l'extranet Husse en gardant un cookie de session en mémoire.
 * Pas de dépendance externe : on récupère les Set-Cookie de la page de login
 * puis on les renvoie sur les requêtes suivantes.
 */
@Injectable()
export class HusseService {
  private readonly logger = new Logger(HusseService.name);
  private readonly configPath = process.env.HUSSE_CONFIG_PATH || path.resolve(process.cwd(), 'tmp', 'husse-config.json');
  private cookieHeader: string | null = null;
  private config: { username: string; password: string } | null = null;
  private allowedOrigin: string | null = null;

  constructor() {
    void this.loadFromDisk();
  }

  async login(payload: HusseLoginDto): Promise<void> {
    const { username, password } = payload;

    let parsed: URL;
    try {
      parsed = new URL(payload.baseUrl);
    } catch {
      throw new Error('baseUrl invalide');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('baseUrl doit être http(s)');
    }

    const response = await fetch(parsed.toString(), {
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
    this.allowedOrigin = parsed.origin;
    this.logger.log('Cookie Husse mis à jour');
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
    this.saveToDisk(dto).catch((err) => this.logger.warn(`Impossible de persister la config Husse: ${err}`));
    this.logger.log('Configuration Husse sauvegardée');
  }

  async getConfig() {
    if (!this.config) {
      await this.loadFromDisk();
    }
    return { hasCredentials: !!this.config };
  }

  private buildCookieHeader(cookies: string[]): string {
    return cookies
      .map((raw) => raw.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }

  private looksLikeLogin(body: string): boolean {
    const lower = body.toLowerCase();
    return lower.includes('co_email') || lower.includes('co_pass') || lower.includes('connexion') || lower.includes('login');
  }

  private async loadFromDisk() {
    try {
      const data = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data) as { username?: string; password?: string };
      if (parsed.username && parsed.password) {
        this.config = { username: parsed.username, password: parsed.password };
        this.logger.log(`Configuration Husse chargée depuis ${this.configPath}`);
      }
    } catch {
      // ignore
    }
  }

  private async saveToDisk(dto: HusseConfigDto) {
    try {
      await fs.promises.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.promises.writeFile(this.configPath, JSON.stringify(dto, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      this.logger.warn(`Échec d'écriture de la config Husse: ${err}`);
    }
  }
}
