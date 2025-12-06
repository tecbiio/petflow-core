import { Module } from '@nestjs/common';
import { AxonautController } from './axonaut.controller';
import { AxonautService } from './axonaut.service';
import { SecureConfigService } from '../common/secure-config.service';

@Module({
  providers: [AxonautService, SecureConfigService],
  controllers: [AxonautController],
  exports: [AxonautService],
})
export class AxonautModule {}
