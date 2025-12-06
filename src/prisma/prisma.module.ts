import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MasterPrismaService } from './master-prisma.service';

@Global()
@Module({
  providers: [PrismaService, MasterPrismaService],
  exports: [PrismaService, MasterPrismaService],
})
export class PrismaModule {}
