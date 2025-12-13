import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto, UpdateProductDto } from './products.dto';
import { normalizeProductPayload } from './products.constraints';

const productInclude = {
  family: true,
  subFamily: {
    include: {
      family: true,
    },
  },
  packaging: true,
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
    const cleaned = normalizeProductPayload(dto, { partial: false });
    const data = this.toCreateInput(cleaned);
    const prisma = this.prisma.client();
    return prisma.product.create({ data, include: productInclude });
  }

  async update(id: number, dto: UpdateProductDto) {
    const prisma = this.prisma.client();
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const cleaned = normalizeProductPayload(dto, { partial: true });
    const data = this.toUpdateInput(cleaned);
    return prisma.product.update({ where: { id }, data, include: productInclude });
  }

  private toCreateInput(dto: UpsertProductDto): Prisma.ProductCreateInput {
    const salePrice = dto.priceSaleHt ?? dto.price;
    return {
      name: dto.name.trim(),
      sku: dto.sku.trim(),
      stockThreshold: dto.stockThreshold ?? 0,
      description: dto.description ?? null,
      price: salePrice,
      priceSaleHt: salePrice,
      priceVdiHt: dto.priceVdiHt,
      priceDistributorHt: dto.priceDistributorHt,
      purchasePrice: dto.purchasePrice,
      tvaRate: dto.tvaRate,
      packaging: dto.packagingId ? { connect: { id: dto.packagingId } } : undefined,
      isActive: dto.isActive ?? true,
      family: dto.familyId ? { connect: { id: dto.familyId } } : undefined,
      subFamily: dto.subFamilyId ? { connect: { id: dto.subFamilyId } } : undefined,
    };
  }

  private toUpdateInput(dto: UpdateProductDto): Prisma.ProductUpdateInput {
    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.sku !== undefined) data.sku = dto.sku.trim();
    if (dto.stockThreshold !== undefined) data.stockThreshold = dto.stockThreshold;
    if (dto.priceSaleHt !== undefined) {
      data.priceSaleHt = dto.priceSaleHt;
      data.price = dto.priceSaleHt;
    }
    if (dto.price !== undefined && dto.priceSaleHt === undefined) {
      data.price = dto.price;
      data.priceSaleHt = dto.price;
    }
    if (dto.priceVdiHt !== undefined) data.priceVdiHt = dto.priceVdiHt;
    if (dto.priceDistributorHt !== undefined) data.priceDistributorHt = dto.priceDistributorHt;
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.tvaRate !== undefined) data.tvaRate = dto.tvaRate;
    if (dto.description !== undefined) {
      data.description = dto.description ?? null;
    }
    if (dto.packagingId !== undefined) {
      data.packaging = dto.packagingId ? { connect: { id: dto.packagingId } } : { disconnect: true };
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

    return data;
  }

}
