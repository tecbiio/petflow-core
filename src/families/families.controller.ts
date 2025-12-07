import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put, Query } from '@nestjs/common';
import { Family, SubFamily } from '@prisma/client';
import { FamiliesService } from './families.service';

@Controller()
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Get('families')
  async listFamilies(): Promise<(Family & { subFamilies: SubFamily[] })[]> {
    return this.familiesService.listFamilies();
  }

  @Put('families')
  async createFamily(@Body() body: { name: string }): Promise<Family> {
    return this.familiesService.createFamily(body.name);
  }

  @Patch('families/:id')
  async updateFamily(@Param('id', ParseIntPipe) id: number, @Body() body: { name: string }): Promise<Family> {
    return this.familiesService.updateFamily(id, body.name);
  }

  @Get('sub-families')
  async listSubFamilies(@Query('familyId') familyId?: string): Promise<SubFamily[]> {
    const fam = familyId ? Number(familyId) : undefined;
    return this.familiesService.listSubFamilies(fam);
  }

  @Put('sub-families')
  async createSubFamily(@Body() body: { familyId: number; name: string }): Promise<SubFamily> {
    return this.familiesService.createSubFamily(body.familyId, body.name);
  }

  @Patch('sub-families/:id')
  async updateSubFamily(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; familyId?: number },
  ): Promise<SubFamily> {
    return this.familiesService.updateSubFamily(id, body);
  }
}
