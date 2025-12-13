import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

type Bucket = {
  count: number;
  resetAtMs: number;
};

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly enabled = process.env.AUTH_LOGIN_RATE_LIMIT_ENABLED !== 'false';
  private readonly windowMs = this.parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  private readonly maxAttempts = this.parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 20);
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const nowMs = Date.now();

    this.prune(nowMs);

    const ip = this.getClientIp(request) ?? 'unknown';
    const email = this.extractEmail(request);

    const ipKey = `ip:${ip}`;
    const ipBucket = this.hit(ipKey, nowMs);
    if (!ipBucket.allowed) {
      response.setHeader('Retry-After', String(ipBucket.retryAfterSeconds));
      throw new HttpException('Trop de tentatives de connexion, réessayez plus tard.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (email) {
      const emailKey = `ip_email:${ip}:${email}`;
      const emailBucket = this.hit(emailKey, nowMs);
      if (!emailBucket.allowed) {
        response.setHeader('Retry-After', String(emailBucket.retryAfterSeconds));
        throw new HttpException('Trop de tentatives de connexion, réessayez plus tard.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    return true;
  }

  private hit(key: string, nowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      this.buckets.set(key, { count: 1, resetAtMs: nowMs + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count <= this.maxAttempts) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAtMs - nowMs) / 1000) };
  }

  private prune(nowMs: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtMs <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }

  private extractEmail(request: Request): string | undefined {
    const body = request.body as { email?: unknown } | undefined;
    if (!body || typeof body.email !== 'string') return undefined;
    const normalized = body.email.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
  }

  private getClientIp(request: Request): string | undefined {
    if (typeof request.ip === 'string' && request.ip.trim().length > 0) {
      return request.ip.trim();
    }
    if (typeof request.socket?.remoteAddress === 'string' && request.socket.remoteAddress.trim().length > 0) {
      return request.socket.remoteAddress.trim();
    }
    return undefined;
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }
}
