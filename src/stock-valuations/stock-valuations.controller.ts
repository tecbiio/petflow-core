import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { StockValuationPoint, StockValuationsService } from './stock-valuations.service';

@Controller('stock-valuations')
export class StockValuationsController {
  constructor(private readonly stockValuationsService: StockValuationsService) {}

  @Get()
  async list(
    @Query('days') days?: string,
    @Query('stockLocationId') stockLocationId?: string,
  ): Promise<StockValuationPoint[]> {
    const parsedDays = days !== undefined ? Number(days) : 30;

    let locationId: number | undefined;
    if (stockLocationId !== undefined && stockLocationId !== null) {
      if (stockLocationId.toLowerCase() === 'all' || stockLocationId === '') {
        locationId = undefined;
      } else {
        const parsed = Number(stockLocationId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new BadRequestException('stockLocationId doit être "all" ou un entier positif');
        }
        locationId = parsed;
      }
    }

    return this.stockValuationsService.getDaily(parsedDays, locationId);
  }
}
