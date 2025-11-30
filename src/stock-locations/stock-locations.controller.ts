import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { StockLocation } from '@prisma/client';
import { StockLocationsService } from './stock-locations.service';

@Controller('stock-locations')
export class StockLocationsController {
  constructor(private readonly stockLocationsService: StockLocationsService) {}

  @Get()
  async list(): Promise<StockLocation[]> {
    return this.stockLocationsService.findAll();
  }

  @Get('default')
  async defaultLocation(): Promise<StockLocation> {
    return this.stockLocationsService.findDefault();
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number): Promise<StockLocation> {
    return this.stockLocationsService.findOne(id);
  }
}
