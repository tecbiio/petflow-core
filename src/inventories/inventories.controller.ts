import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { Inventory } from '@prisma/client';
import type { CreateInventoryDto } from './inventories.dto';
import { InventoriesService } from './inventories.service';

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventoriesService: InventoriesService) {}

  @Get()
  async list(@Query('productId') productId?: string): Promise<Inventory[]> {
    let parsedProductId: number | undefined;
    if (productId !== undefined) {
      parsedProductId = Number(productId);
      if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
        throw new BadRequestException('productId must be a positive integer');
      }
    }
    return this.inventoriesService.findAll(parsedProductId ? { productId: parsedProductId } : undefined);
  }

  @Get('product/:productId')
  async byProduct(@Param('productId', ParseIntPipe) productId: number): Promise<Inventory[]> {
    return this.inventoriesService.findByProductId(productId);
  }

  @Get('stock-location/:stockLocationId')
  async byStockLocation(
    @Param('stockLocationId', ParseIntPipe) stockLocationId: number,
  ): Promise<Inventory[]> {
    return this.inventoriesService.findByStockLocationId(stockLocationId);
  }

  @Get('date/:date')
  async byDate(@Param('date') date: string): Promise<Inventory[]> {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date format, expected ISO-like date string');
    }
    return this.inventoriesService.findByDate(parsed);
  }

  @Put()
  async create(@Body() dto: CreateInventoryDto): Promise<Inventory> {
    return this.inventoriesService.create(dto);
  }
}
