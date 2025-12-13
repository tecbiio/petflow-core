import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/auth/public.decorator';
import { MasterPrismaService } from './prisma/master-prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly masterPrisma: MasterPrismaService,
  ) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  async health() {
    try {
      await this.masterPrisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, masterDb: 'down' });
    }
    return { ok: true, masterDb: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
