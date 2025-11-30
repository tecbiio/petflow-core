import { Module } from '@nestjs/common';
import { StockLocationsController } from './stock-locations.controller';
import { StockLocationsService } from './stock-locations.service';

@Module({
  controllers: [StockLocationsController],
  providers: [StockLocationsService],
})
export class StockLocationsModule {}
