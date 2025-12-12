import { Module } from '@nestjs/common';
import { StockValuationsController } from './stock-valuations.controller';
import { StockValuationsService } from './stock-valuations.service';

@Module({
  controllers: [StockValuationsController],
  providers: [StockValuationsService],
})
export class StockValuationsModule {}
