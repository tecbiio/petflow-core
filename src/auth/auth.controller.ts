import { BadRequestException, Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/auth/public.decorator';
import { AuthService, TokenPayload } from './auth.service';

type LoginDto = {
  username?: string;
  password?: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    if (!body?.username || !body?.password) {
      throw new BadRequestException('username et password sont requis');
    }
    const session = this.authService.login(body.username, body.password);
    this.authService.attachAuthCookie(res, session.token, session.payload.exp * 1000);
    return { user: { username: session.payload.sub }, expiresAt: session.payload.exp * 1000 };
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
    return { user: { username: req.user.sub }, expiresAt: req.user.exp * 1000 };
  }
}
