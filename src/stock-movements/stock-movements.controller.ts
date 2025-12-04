import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import type { CreateStockMovementDto } from './stock-movements.dto';
import { StockMovementsService } from './stock-movements.service';

@Controller('stock-movements')
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Get('product/:productId')
  async byProduct(@Param('productId', ParseIntPipe) productId: number): Promise<StockMovement[]> {
    return this.stockMovementsService.findByProductId(productId);
  }

  @Get('stock-location/:stockLocationId')
  async byStockLocation(
    @Param('stockLocationId', ParseIntPipe) stockLocationId: number,
  ): Promise<StockMovement[]> {
    return this.stockMovementsService.findByStockLocationId(stockLocationId);
  }

  @Get('date/:date')
  async byDate(@Param('date') date: string): Promise<StockMovement[]> {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date format, expected ISO-like date string');
    }
    return this.stockMovementsService.findByDate(parsed);
  }

  @Put()
  async create(@Body() dto: CreateStockMovementDto): Promise<StockMovement> {
    return this.stockMovementsService.createOne(dto);
  }

  @Post('bulk')
  async createBulk(@Body() dtos: CreateStockMovementDto[]): Promise<{ created: number; movements: StockMovement[] }> {
    if (!Array.isArray(dtos)) {
      throw new BadRequestException('Expected an array of stock movements');
    }
    const movements = await this.stockMovementsService.createMany(dtos);
    return { created: movements.length, movements };
  }
}
