import { Injectable, Logger } from '@nestjs/common';
import { HusseFetchDto, HusseLoginDto } from './husse.dto';

/**
 * Service minimaliste pour interagir avec l'extranet Husse en gardant un cookie de session en mémoire.
 * Pas de dépendance externe : on récupère les Set-Cookie de la page de login
 * puis on les renvoie sur les requêtes suivantes.
 */
@Injectable()
export class HusseService {
  private readonly logger = new Logger(HusseService.name);
  private cookieHeader: string | null = null;

  async login(payload: HusseLoginDto): Promise<void> {
    const { baseUrl, username, password } = payload;
    const response = await fetch(baseUrl, {
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
    this.logger.log('Cookie Husse mis à jour');
  }

  async fetchPages(dto: HusseFetchDto): Promise<{ pages: { url: string; html: string }[]; encounteredLoginPage: boolean }> {
    if (!this.cookieHeader) {
      throw new Error('Session Husse manquante : appelez /husse/login avant /husse/fetch');
    }

    const pages: { url: string; html: string }[] = [];
    let encounteredLoginPage = false;

    for (const url of dto.urls) {
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
}
