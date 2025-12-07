import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Family, SubFamily } from '@prisma/client';

@Injectable()
export class FamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  async listFamilies(): Promise<(Family & { subFamilies: SubFamily[] })[]> {
    const prisma = this.prisma.client();
    return prisma.family.findMany({
      include: { subFamilies: true },
      orderBy: { name: 'asc' },
    });
  }

  async createFamily(name: string): Promise<Family> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('name is required');
    const prisma = this.prisma.client();
    return prisma.family.create({ data: { name: trimmed } });
  }

  async updateFamily(id: number, name: string): Promise<Family> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('name is required');
    const prisma = this.prisma.client();
    const existing = await prisma.family.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Family ${id} not found`);
    return prisma.family.update({ where: { id }, data: { name: trimmed } });
  }

  async listSubFamilies(familyId?: number): Promise<SubFamily[]> {
    const prisma = this.prisma.client();
    return prisma.subFamily.findMany({
      where: familyId ? { familyId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async createSubFamily(familyId: number, name: string): Promise<SubFamily> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('name is required');
    if (!Number.isInteger(familyId)) throw new BadRequestException('familyId is required');
    const prisma = this.prisma.client();
    return prisma.subFamily.create({ data: { name: trimmed, familyId } });
  }

  async updateSubFamily(id: number, data: { name?: string; familyId?: number }): Promise<SubFamily> {
    const prisma = this.prisma.client();
    const existing = await prisma.subFamily.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Sub-family ${id} not found`);
    const updateData: Partial<SubFamily> = {};
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new BadRequestException('name is required');
      updateData.name = trimmed;
    }
    if (data.familyId !== undefined) {
      if (!Number.isInteger(data.familyId)) throw new BadRequestException('familyId must be an integer');
      updateData.familyId = data.familyId;
    }
    if (Object.keys(updateData).length === 0) throw new BadRequestException('No data to update');
    return prisma.subFamily.update({ where: { id }, data: updateData });
  }
}
