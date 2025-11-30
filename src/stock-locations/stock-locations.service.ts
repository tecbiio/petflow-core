import { Injectable, NotFoundException } from '@nestjs/common';
import { StockLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StockLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<StockLocation[]> {
    return this.prisma.stockLocation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number): Promise<StockLocation> {
    const stockLocation = await this.prisma.stockLocation.findUnique({ where: { id } });
    if (!stockLocation) {
      throw new NotFoundException(`StockLocation ${id} not found`);
    }
    return stockLocation;
  }

  async findDefault(): Promise<StockLocation> {
    const stockLocation = await this.prisma.stockLocation.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!stockLocation) {
      throw new NotFoundException('Default stock location not found');
    }

    return stockLocation;
  }
}
