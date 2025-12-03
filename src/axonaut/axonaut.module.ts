import { Module } from '@nestjs/common';
import { AxonautController } from './axonaut.controller';
import { AxonautService } from './axonaut.service';

@Module({
  providers: [AxonautService],
  controllers: [AxonautController],
})
export class AxonautModule {}
