import { BadRequestException, Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get(':productId')
  async getCurrent(@Param('productId', ParseIntPipe) productId: number): Promise<{ stock: number }> {
    const stock = await this.stockService.getCurrentStock(productId);
    return { stock };
  }

  @Get(':productId/at/:date')
  async getAtDate(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('date') date: string,
  ): Promise<{ stock: number }> {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date format, expected ISO-like string');
    }
    const stock = await this.stockService.getStockAt(productId, parsed);
    return { stock };
  }

  @Get(':productId/variations')
  async getVariations(
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<StockMovement[]> {
    return this.stockService.getVariations(productId);
  }
}
