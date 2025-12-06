import { BadRequestException, Injectable } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stock at current moment.
   */
  async getCurrentStock(productId: number): Promise<number> {
    return this.getStockAt(productId, new Date());
  }

  /**
   * Stock at a given date.
   */
  async getStockAt(productId: number, at: Date): Promise<number> {
    const prisma = this.prisma.client();
    const target = new Date(at);
    if (isNaN(target.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const lastInventory = await prisma.inventory.findFirst({
      where: { productId, createdAt: { lte: target } },
      orderBy: { createdAt: 'desc' },
    });

    const baseQuantity = lastInventory?.quantity ?? 0;
    const fromDate = lastInventory?.createdAt;

    const movementsSum = await prisma.stockMovement.aggregate({
      _sum: { quantityDelta: true },
      where: {
        productId,
        createdAt: fromDate
          ? {
              gt: fromDate,
              lte: target,
            }
          : {
              lte: target,
            },
      },
    });

    return baseQuantity + (movementsSum._sum.quantityDelta ?? 0);
  }

  /**
   * Stock variations (raw movements) for a product.
   */
  async getVariations(productId: number): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    return prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
