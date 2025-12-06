import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, StockLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateStockLocationDto, UpsertStockLocationDto } from './stock-locations.dto';

@Injectable()
export class StockLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<StockLocation[]> {
    const prisma = this.prisma.client();
    return prisma.stockLocation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number): Promise<StockLocation> {
    const prisma = this.prisma.client();
    const stockLocation = await prisma.stockLocation.findUnique({ where: { id } });
    if (!stockLocation) {
      throw new NotFoundException(`StockLocation ${id} not found`);
    }
    return stockLocation;
  }

  async findDefault(): Promise<StockLocation> {
    const prisma = this.prisma.client();
    const stockLocation = await prisma.stockLocation.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!stockLocation) {
      throw new NotFoundException('Default stock location not found');
    }

    return stockLocation;
  }

  async create(dto: UpsertStockLocationDto): Promise<StockLocation> {
    const data = this.toCreateInput(dto);
    const prisma = this.prisma.client();
    const created = await prisma.stockLocation.create({ data });
    if (created.isDefault) {
      await this.unsetDefaultExcept(created.id);
    }
    return created;
  }

  async update(id: number, dto: UpdateStockLocationDto): Promise<StockLocation> {
    const prisma = this.prisma.client();
    const existing = await prisma.stockLocation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`StockLocation ${id} not found`);
    }

    const data = this.toUpdateInput(dto);
    const updated = await prisma.stockLocation.update({ where: { id }, data });
    if (updated.isDefault) {
      await this.unsetDefaultExcept(updated.id);
    }
    return updated;
  }

  private toCreateInput(dto: UpsertStockLocationDto): Prisma.StockLocationCreateInput {
    this.assertNameAndCode(dto.name, dto.code);
    return {
      name: dto.name.trim(),
      code: dto.code.trim(),
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
    };
  }

  private toUpdateInput(dto: UpdateStockLocationDto): Prisma.StockLocationUpdateInput {
    const data: Prisma.StockLocationUpdateInput = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('name cannot be empty');
      data.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('code cannot be empty');
      data.code = dto.code.trim();
    }
    if (dto.isDefault !== undefined) {
      data.isDefault = dto.isDefault;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields provided for update');
    }

    return data;
  }

  private async unsetDefaultExcept(id: number) {
    const prisma = this.prisma.client();
    await prisma.stockLocation.updateMany({
      where: { id: { not: id }, isDefault: true },
      data: { isDefault: false },
    });
  }

  private assertNameAndCode(name?: string, code?: string) {
    if (!name || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!code || !code.trim()) {
      throw new BadRequestException('code is required');
    }
  }
}
