import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import type { TokenPayload } from './auth.service';

@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<{ user?: TokenPayload }>();
    const tenantId = request.user?.tenantId;
    const tenantCode = request.user?.tenantCode;
    const dbUrl = request.user?.dbUrl;
    const userId = request.user?.userId;

    if (!tenantId || !dbUrl || !tenantCode) {
      return next.handle();
    }

    return this.prisma.runWithTenant({ tenantId, tenantCode, dbUrl, userId }, () => next.handle());
  }
}
