import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, Inventory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInventoryDto } from './inventories.dto';

@Injectable()
export class InventoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductId(productId: number): Promise<Inventory[]> {
    return this.prisma.inventory.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStockLocationId(stockLocationId: number): Promise<Inventory[]> {
    return this.prisma.inventory.findMany({
      where: { stockLocationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByDate(date: Date): Promise<Inventory[]> {
    const start = new Date(date);
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    const end = new Date(start);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    return this.prisma.inventory.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateInventoryDto): Promise<Inventory> {
    const data = this.toCreateInput(dto);
    return this.prisma.inventory.create({ data });
  }

  private toCreateInput(dto: CreateInventoryDto): Prisma.InventoryCreateInput {
    if (!Number.isInteger(dto?.productId) || dto.productId <= 0) {
      throw new BadRequestException('productId must be a positive integer');
    }
    if (!Number.isInteger(dto?.stockLocationId) || dto.stockLocationId <= 0) {
      throw new BadRequestException('stockLocationId must be a positive integer');
    }
    if (!Number.isInteger(dto.quantity)) {
      throw new BadRequestException('quantity must be an integer');
    }

    let createdAt: Date | undefined;
    if (dto.createdAt) {
      const parsed = new Date(dto.createdAt);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException('createdAt must be a valid date');
      }
      createdAt = parsed;
    }

    return {
      product: { connect: { id: dto.productId } },
      stockLocation: { connect: { id: dto.stockLocationId } },
      quantity: dto.quantity,
      ...(createdAt ? { createdAt } : {}),
    };
  }
}
