import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put, Query } from '@nestjs/common';
import { StockLocation } from '@prisma/client';
import type { UpdateStockLocationDto, UpsertStockLocationDto } from './stock-locations.dto';
import { StockLocationsService } from './stock-locations.service';

@Controller('stock-locations')
export class StockLocationsController {
  constructor(private readonly stockLocationsService: StockLocationsService) {}

  @Get()
  async list(@Query('active') active?: string): Promise<StockLocation[]> {
    return this.stockLocationsService.findAll(active);
  }

  @Get('default')
  async defaultLocation(): Promise<StockLocation> {
    return this.stockLocationsService.findDefault();
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number): Promise<StockLocation> {
    return this.stockLocationsService.findOne(id);
  }

  @Put()
  async create(@Body() dto: UpsertStockLocationDto): Promise<StockLocation> {
    return this.stockLocationsService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockLocationDto,
  ): Promise<StockLocation> {
    return this.stockLocationsService.update(id, dto);
  }
}
