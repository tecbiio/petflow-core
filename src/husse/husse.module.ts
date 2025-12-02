import { Module } from '@nestjs/common';
import { HusseService } from './husse.service';
import { HusseController } from './husse.controller';

@Module({
  providers: [HusseService],
  controllers: [HusseController],
})
export class HusseModule {}
