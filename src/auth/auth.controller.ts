import { BadRequestException, Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/auth/public.decorator';
import { AuthService, TokenPayload } from './auth.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

type LoginDto = {
  email?: string;
  password?: string;
  tenant?: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @UseGuards(LoginRateLimitGuard)
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email et password sont requis');
    }
    const session = await this.authService.login(body.email, body.password, body.tenant);
    this.authService.attachAuthCookie(res, session.token, session.payload.exp * 1000);
    const response = {
      user: {
        email: session.payload.sub,
        role: session.payload.role,
        tenant: session.payload.tenantCode,
        dbUrl: session.payload.dbUrl,
      },
      expiresAt: session.payload.exp * 1000,
    };
    const authModeHeader = req.headers['x-petflow-auth-mode'];
    const authMode = Array.isArray(authModeHeader) ? authModeHeader[0] : authModeHeader;
    if (String(authMode ?? '').trim().toLowerCase() === 'bearer') {
      return { ...response, token: session.token };
    }
    return response;
  }

  @Post('logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAuthCookie(res);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request & { user?: TokenPayload }) {
    if (!req.user) {
      throw new BadRequestException('Aucune session active');
    }
    return {
      user: {
        email: req.user.sub,
        role: req.user.role,
        tenant: req.user.tenantCode,
        userId: req.user.userId,
        dbUrl: req.user.dbUrl,
      },
      expiresAt: req.user.exp * 1000,
    };
  }
}
