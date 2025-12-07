import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Packaging } from '@prisma/client';

@Injectable()
export class PackagingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Packaging[]> {
    const prisma = this.prisma.client();
    return prisma.packaging.findMany({ orderBy: { name: 'asc' } });
  }

  async create(name: string): Promise<Packaging> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    const prisma = this.prisma.client();
    return prisma.packaging.upsert({
      where: { name: trimmed },
      update: {},
      create: { name: trimmed },
    });
  }

  async update(id: number, name: string): Promise<Packaging> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    const prisma = this.prisma.client();
    const existing = await prisma.packaging.findUnique({ where: { id } });
    if (!existing) {
      throw new BadRequestException(`packaging ${id} not found`);
    }
    return prisma.packaging.update({ where: { id }, data: { name: trimmed } });
  }
}
