import { Module } from '@nestjs/common';
import { HusseService } from './husse.service';
import { HusseController } from './husse.controller';
import { SecureConfigService } from '../common/secure-config.service';

@Module({
  providers: [HusseService, SecureConfigService],
  controllers: [HusseController],
})
export class HusseModule {}
