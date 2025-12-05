import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import { StockMovementReason } from '../common/enums/stock-movement-reason.enum';
import type { CreateStockMovementDto } from './stock-movements.dto';
import { StockMovementsService } from './stock-movements.service';

@Controller('stock-movements')
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Get()
  async list(
    @Query('productId') productId?: string,
    @Query('reason') reason?: StockMovementReason | StockMovementReason[],
  ): Promise<StockMovement[]> {
    let parsedProductId: number | undefined;
    if (productId !== undefined) {
      parsedProductId = Number(productId);
      if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
        throw new BadRequestException('productId doit être un entier positif');
      }
    }

    const reasonsFilter = this.normalizeReasons(reason);

    const filter: { productId?: number; reasons?: StockMovementReason[] } = {};
    if (parsedProductId) filter.productId = parsedProductId;
    if (reasonsFilter.length > 0) filter.reasons = reasonsFilter;

    return this.stockMovementsService.findAll(filter);
  }

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

  private normalizeReasons(input?: StockMovementReason | StockMovementReason[]): StockMovementReason[] {
    if (input === undefined || input === null) return [];
    const values = Array.isArray(input) ? input : [input];
    const normalized = values
      .map((value) => String(value).trim().toUpperCase())
      .filter((v) => v.length > 0) as StockMovementReason[];

    if (normalized.length === 0) return [];

    const allowed = new Set(Object.values(StockMovementReason));
    const invalid = normalized.filter((reason) => !allowed.has(reason));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `reason doit être parmi: ${Object.values(StockMovementReason).join(', ')}`,
      );
    }

    // Déduplication pour éviter des conditions inutiles
    return Array.from(new Set(normalized)) as StockMovementReason[];
  }
}
