import { Body, Controller, Get, Put } from '@nestjs/common';
import { Packaging } from '@prisma/client';
import { PackagingsService } from './packagings.service';
import { Param, ParseIntPipe, Patch } from '@nestjs/common';

@Controller('packagings')
export class PackagingsController {
  constructor(private readonly packagingsService: PackagingsService) {}

  @Get()
  async list(): Promise<Packaging[]> {
    return this.packagingsService.list();
  }

  @Put()
  async create(@Body() body: { name: string }): Promise<Packaging> {
    return this.packagingsService.create(body.name);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: { name: string }): Promise<Packaging> {
    return this.packagingsService.update(id, body.name);
  }
}
