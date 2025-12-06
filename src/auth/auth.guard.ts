import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, TokenPayload } from './auth.service';
import { IS_PUBLIC_KEY } from '../common/auth/public.decorator';

type AuthenticatedRequest = Request & { user?: TokenPayload };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentification requise');
    }

    const payload = this.authService.verifyToken(token);
    request.user = payload;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string') {
      const [scheme, value] = authHeader.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && value) {
        return value.trim();
      }
    }

    const cookies = this.parseCookies(request.headers.cookie);
    if (cookies.auth_token) {
      return cookies.auth_token;
    }

    return undefined;
  }

  private parseCookies(rawCookie?: string): Record<string, string> {
    if (!rawCookie) return {};
    return rawCookie.split(';').reduce<Record<string, string>>((acc, part) => {
      const [key, ...rest] = part.trim().split('=');
      if (!key) return acc;
      acc[key] = rest.join('=');
      return acc;
    }, {});
  }
}
