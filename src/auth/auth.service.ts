import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Response } from 'express';

export type TokenPayload = {
  sub: string;
  iat: number;
  exp: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly username = (process.env.AUTH_USER ?? 'admin').trim();
  private readonly passwordHash = this.resolvePasswordHash();
  private readonly tokenTtlMs = this.resolveTtl();
  private readonly signingKey = this.resolveSigningKey();

  login(username: string, password: string): { token: string; payload: TokenPayload } {
    if (!username || !password) {
      throw new UnauthorizedException('Identifiants manquants');
    }

    if (!this.passwordHash) {
      throw new UnauthorizedException('AUTH_PASSWORD (ou AUTH_PASSWORD_HASH) n’est pas configuré côté serveur.');
    }

    if (!this.safeEqualStrings(username.trim(), this.username)) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!this.safeEqualBuffers(this.passwordHash, this.hashPassword(password))) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const payload = this.buildPayload();
    const token = this.encodeToken(payload);
    return { token, payload };
  }

  verifyToken(token: string): TokenPayload {
    if (!token) {
      throw new UnauthorizedException('Authentification requise');
    }

    const [rawPayload, signature] = token.split('.');
    if (!rawPayload || !signature) {
      throw new UnauthorizedException('Token invalide');
    }

    const expectedSignature = this.sign(rawPayload);
    if (!this.safeEqualStrings(signature, expectedSignature)) {
      throw new UnauthorizedException('Token invalide');
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf-8')) as TokenPayload;
    } catch {
      throw new UnauthorizedException('Token invalide');
    }

    if (!payload?.sub || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token invalide');
    }

    if (!this.safeEqualStrings(payload.sub, this.username)) {
      throw new UnauthorizedException('Utilisateur inconnu');
    }

    if (payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('Session expirée');
    }

    return payload;
  }

  attachAuthCookie(res: Response, token: string, expiresAtMs: number) {
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isCookieSecure(),
      maxAge: Math.max(1000, expiresAtMs - Date.now()),
      path: '/',
    });
  }

  clearAuthCookie(res: Response) {
    res.cookie('auth_token', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isCookieSecure(),
      maxAge: 0,
      path: '/',
    });
  }

  private buildPayload(): TokenPayload {
    const iat = Math.floor(Date.now() / 1000);
    const exp = Math.floor((Date.now() + this.tokenTtlMs) / 1000);
    return { sub: this.username, iat, exp };
  }

  private encodeToken(payload: TokenPayload): string {
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(rawPayload);
    return `${rawPayload}.${signature}`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }

  private resolvePasswordHash(): Buffer | null {
    const hashed = process.env.AUTH_PASSWORD_HASH?.trim();
    if (hashed) {
      try {
        return Buffer.from(hashed, 'hex');
      } catch (err) {
        this.logger.warn(`AUTH_PASSWORD_HASH invalide (doit être hexadécimal SHA-256) : ${err}`);
      }
    }

    const plain = process.env.AUTH_PASSWORD?.trim();
    if (plain) {
      return this.hashPassword(plain);
    }

    this.logger.warn('Aucun mot de passe fourni (AUTH_PASSWORD ou AUTH_PASSWORD_HASH). Les connexions seront refusées.');
    return null;
  }

  private resolveSigningKey(): Buffer {
    const explicit = process.env.AUTH_TOKEN_SECRET?.trim();
    if (explicit) {
      return Buffer.from(explicit, 'utf-8');
    }
    if (this.passwordHash) {
      return this.passwordHash;
    }
    const random = randomBytes(32);
    this.logger.warn('AUTH_TOKEN_SECRET non défini : clé éphémère générée (les sessions expireront au redémarrage).');
    return random;
  }

  private resolveTtl(): number {
    const parsed = Number(process.env.AUTH_TOKEN_TTL_MS ?? 1000 * 60 * 60 * 12);
    if (!Number.isFinite(parsed) || parsed < 5 * 60 * 1000) {
      return 1000 * 60 * 60 * 12;
    }
    return parsed;
  }

  private hashPassword(password: string): Buffer {
    return createHmac('sha256', 'petflow-auth-salt').update(password).digest();
  }

  private safeEqualStrings(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    return this.safeEqualBuffers(aBuf, bBuf);
  }

  private safeEqualBuffers(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private isCookieSecure(): boolean {
    return process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  }
}
