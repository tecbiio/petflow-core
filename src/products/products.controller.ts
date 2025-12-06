import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put, Query } from '@nestjs/common';
import { Product } from '@prisma/client';
import type { UpdateProductDto, UpsertProductDto } from './products.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async list(
    @Query('active') active?: string,
    @Query('familyId') familyId?: string,
    @Query('subFamilyId') subFamilyId?: string,
  ): Promise<Product[]> {
    const filter = {
      active: active === undefined ? undefined : active === 'true',
      familyId: familyId ? Number(familyId) : undefined,
      subFamilyId: subFamilyId ? Number(subFamilyId) : undefined,
    };
    return this.productsService.findAll(filter);
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number): Promise<Product> {
    return this.productsService.findOne(id);
  }

  @Put()
  async create(@Body() dto: UpsertProductDto): Promise<Product> {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.productsService.update(id, dto);
  }
}
