import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Tenant, User } from '@prisma/master-client';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterPrismaService } from '../prisma/master-prisma.service';

type UserRole = 'ADMIN' | 'USER';

export type TokenPayload = {
  sub: string; // email
  userId: number;
  tenantId: number;
  tenantCode: string;
  dbUrl: string;
  role: UserRole;
  iat: number;
  exp: number;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly tokenTtlMs = this.resolveTtl();
  private readonly signingKey = this.resolveSigningKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly masterPrisma: MasterPrismaService,
  ) {}

  async onModuleInit() {
    await this.bootstrapDefaultUser();
  }

  async login(email: string, password: string, tenantCode?: string): Promise<{ token: string; payload: TokenPayload }> {
    if (!email || !password) {
      throw new UnauthorizedException('Identifiants manquants');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const tenant = await this.resolveTenant(normalizedEmail, tenantCode);
    const user = await this.masterPrisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: normalizedEmail } },
    });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable pour ce tenant');
    }

    if (!this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const payload = this.buildPayload(user, tenant);
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

    if (!payload?.sub || typeof payload.exp !== 'number' || !payload.tenantId || !payload.userId) {
      throw new UnauthorizedException('Token invalide');
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

  private buildPayload(user: User, tenant: Tenant): TokenPayload {
    const iat = Math.floor(Date.now() / 1000);
    const exp = Math.floor((Date.now() + this.tokenTtlMs) / 1000);
    return {
      sub: user.email,
      userId: user.id,
      tenantId: tenant.id,
      tenantCode: tenant.code,
      dbUrl: tenant.databaseUrl,
      role: (user.role as UserRole) ?? 'USER',
      iat,
      exp,
    };
  }

  private encodeToken(payload: TokenPayload): string {
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(rawPayload);
    return `${rawPayload}.${signature}`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }

  private resolveSigningKey(): Buffer {
    const explicit = process.env.AUTH_TOKEN_SECRET?.trim();
    if (explicit) {
      return Buffer.from(explicit, 'utf-8');
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_TOKEN_SECRET manquant en production.');
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

  private hashPassword(password: string, salt?: Buffer): string {
    const actualSalt = salt ?? randomBytes(16);
    const derived = scryptSync(password, actualSalt, 32);
    return `${actualSalt.toString('hex')}:${derived.toString('hex')}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = scryptSync(password, salt, 32);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
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

  private async resolveTenant(email: string, tenantCode?: string): Promise<Tenant> {
    if (tenantCode) {
      const tenant = await this.masterPrisma.tenant.findUnique({
        where: { code: tenantCode.trim().toLowerCase() },
      });
      if (!tenant) {
        throw new UnauthorizedException('Tenant inconnu');
      }
      return tenant;
    }

    const matches = await this.masterPrisma.user.findMany({ where: { email }, select: { tenant: true } });
    if (matches.length === 0) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    if (matches.length > 1) {
      throw new UnauthorizedException('Plusieurs tenants pour cet utilisateur : précisez le tenant.');
    }
    return matches[0].tenant;
  }

  private async bootstrapDefaultUser() {
    const userCount = await this.masterPrisma.user.count();
    if (userCount > 0) return;

    const email = (process.env.AUTH_BOOTSTRAP_USER ?? process.env.AUTH_USER)?.trim();
    const password = (process.env.AUTH_BOOTSTRAP_PASSWORD ?? process.env.AUTH_PASSWORD)?.trim();
    const tenantCode = (process.env.AUTH_BOOTSTRAP_TENANT ?? 'default').trim().toLowerCase();
    const tenantName = process.env.AUTH_BOOTSTRAP_TENANT_NAME ?? 'Default tenant';
    const tenantDbUrl = process.env.AUTH_BOOTSTRAP_TENANT_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!email || !password) {
      this.logger.warn(
        'Aucun utilisateur trouvé et aucune variable AUTH_BOOTSTRAP_USER/PASSWORD définie. Créez un compte manuellement.',
      );
      return;
    }

    if (!tenantDbUrl) {
      this.logger.warn('AUTH_BOOTSTRAP_TENANT_DATABASE_URL manquant : impossible de créer le tenant par défaut.');
      return;
    }

    const tenant = await this.masterPrisma.tenant.create({
      data: {
        code: tenantCode,
        name: tenantName,
        databaseUrl: tenantDbUrl,
      },
    });

    const passwordHash = this.hashPassword(password);
    await this.masterPrisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });

    const locationCode = (process.env.AUTH_BOOTSTRAP_LOCATION_CODE ?? 'MAIN').trim().toUpperCase();
    const locationName = (process.env.AUTH_BOOTSTRAP_LOCATION_NAME ?? 'Emplacement principal').trim();

    try {
      const tenantPrisma = new PrismaClient({ datasources: { db: { url: tenantDbUrl } } });
      try {
        await tenantPrisma.stockLocation.upsert({
          where: { code: locationCode },
          update: { name: locationName, isDefault: true, isActive: true },
          create: { code: locationCode, name: locationName, isDefault: true, isActive: true },
        });
        await tenantPrisma.stockLocation.updateMany({
          where: { code: { not: locationCode }, isDefault: true },
          data: { isDefault: false },
        });
      } finally {
        await tenantPrisma.$disconnect();
      }
    } catch (err) {
      this.logger.warn(`Création de l'emplacement par défaut échouée: ${err}`);
    }

    this.logger.log(`Tenant "${tenantCode}" et utilisateur admin "${email}" créés (bootstrap). Base: ${tenantDbUrl}`);
  }
}
