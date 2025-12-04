import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto, UpdateProductDto } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Product[]> {
    return this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }

  async create(dto: UpsertProductDto): Promise<Product> {
    const data = this.toCreateInput(dto);
    return this.prisma.product.create({ data });
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const data = this.toUpdateInput(dto);
    return this.prisma.product.update({ where: { id }, data });
  }

  private toCreateInput(dto: UpsertProductDto): Prisma.ProductCreateInput {
    this.assertNameAndSku(dto.name, dto.sku);
    if (!Number.isFinite(dto.price)) {
      throw new BadRequestException('price must be a number');
    }
    return {
      name: dto.name.trim(),
      sku: dto.sku.trim(),
      description: dto.description ?? null,
      price: dto.price,
      isActive: dto.isActive ?? true,
    };
  }

  private toUpdateInput(dto: UpdateProductDto): Prisma.ProductUpdateInput {
    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('name cannot be empty');
      data.name = dto.name.trim();
    }
    if (dto.sku !== undefined) {
      if (!dto.sku.trim()) throw new BadRequestException('sku cannot be empty');
      data.sku = dto.sku.trim();
    }
    if (dto.price !== undefined) {
      if (!Number.isFinite(dto.price)) throw new BadRequestException('price must be a number');
      data.price = dto.price;
    }
    if (dto.description !== undefined) {
      data.description = dto.description ?? null;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields provided for update');
    }

    return data;
  }

  private assertNameAndSku(name?: string, sku?: string) {
    if (!name || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!sku || !sku.trim()) {
      throw new BadRequestException('sku is required');
    }
  }
}
