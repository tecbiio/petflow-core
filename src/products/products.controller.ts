import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Product } from '@prisma/client';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async list(): Promise<Product[]> {
    return this.productsService.findAll();
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number): Promise<Product> {
    return this.productsService.findOne(id);
  }
}
