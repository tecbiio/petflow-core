import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto, UpdateProductDto } from './products.dto';

const productInclude = {
  family: true,
  subFamily: {
    include: {
      family: true,
    },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter?: { active?: boolean; familyId?: number; subFamilyId?: number }) {
    const prisma = this.prisma.client();
    const where: Prisma.ProductWhereInput = {};
    if (filter?.active !== undefined) {
      where.isActive = filter.active;
    }
    if (filter?.familyId) {
      where.familyId = filter.familyId;
    }
    if (filter?.subFamilyId) {
      where.subFamilyId = filter.subFamilyId;
    }

    return prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, include: productInclude });
  }

  async findOne(id: number) {
    const prisma = this.prisma.client();
    const product = await prisma.product.findUnique({ where: { id }, include: productInclude });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }

  async create(dto: UpsertProductDto) {
    const data = this.toCreateInput(dto);
    const prisma = this.prisma.client();
    return prisma.product.create({ data, include: productInclude });
  }

  async update(id: number, dto: UpdateProductDto) {
    const prisma = this.prisma.client();
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const data = this.toUpdateInput(dto);
    return prisma.product.update({ where: { id }, data, include: productInclude });
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
      family: dto.familyId ? { connect: { id: dto.familyId } } : undefined,
      subFamily: dto.subFamilyId ? { connect: { id: dto.subFamilyId } } : undefined,
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
    if (dto.familyId !== undefined) {
      data.family = dto.familyId ? { connect: { id: dto.familyId } } : { disconnect: true };
    }
    if (dto.subFamilyId !== undefined) {
      data.subFamily = dto.subFamilyId ? { connect: { id: dto.subFamilyId } } : { disconnect: true };
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
