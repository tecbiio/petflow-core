import { Module } from '@nestjs/common';
import { PackagingsController } from './packagings.controller';
import { PackagingsService } from './packagings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PackagingsController],
  providers: [PackagingsService],
})
export class PackagingsModule {}
