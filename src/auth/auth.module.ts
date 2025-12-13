import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { TenantScopeInterceptor } from './tenant-scope.interceptor';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginRateLimitGuard,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantScopeInterceptor,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
