import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma, StockMovement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockMovementDto } from './stock-movements.dto';
import { StockMovementReason } from '../common/enums/stock-movement-reason.enum';

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter?: { productId?: number; reasons?: StockMovementReason[] }): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    const where: Prisma.StockMovementWhereInput = {};
    if (filter?.productId !== undefined) {
      where.productId = filter.productId;
    }
    if (filter?.reasons && filter.reasons.length > 0) {
      where.reason = { in: filter.reasons };
    }
    return prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findByProductId(productId: number): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    return prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStockLocationId(stockLocationId: number): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    return prisma.stockMovement.findMany({
      where: { stockLocationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByDate(date: Date): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    const start = new Date(date);
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    const end = new Date(start);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    return prisma.stockMovement.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOne(dto: CreateStockMovementDto): Promise<StockMovement> {
    const prisma = this.prisma.client();
    const data = this.toCreateInput(dto);
    return prisma.stockMovement.create({ data });
  }

  async createMany(dtos: CreateStockMovementDto[]): Promise<StockMovement[]> {
    const prisma = this.prisma.client();
    if (!Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestException('At least one stock movement is required');
    }

    const data = dtos.map((dto) => this.toCreateInput(dto));

    const created = await prisma.$transaction(
      data.map((movement) => prisma.stockMovement.create({ data: movement })),
    );

    return created;
  }

  async exportDisposalsExcel(): Promise<Buffer> {
    const prisma = this.prisma.client();
    const reasons = [StockMovementReason.PERSO, StockMovementReason.POUBELLE, StockMovementReason.DON];

    const movements = await prisma.stockMovement.findMany({
      where: { reason: { in: reasons } },
      orderBy: { createdAt: 'asc' },
      include: {
        product: true,
        stockLocation: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mouvements');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Produit', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Emplacement', key: 'location', width: 22 },
      { header: 'Raison', key: 'reason', width: 14 },
      { header: 'Quantité', key: 'quantity', width: 12 },
    ];

    const totals = new Map<string, number>();
    let grandTotal = 0;

    movements.forEach((m) => {
      const qty = m.quantityDelta;
      totals.set(m.reason, (totals.get(m.reason) ?? 0) + qty);
      grandTotal += qty;
      sheet.addRow({
        date: new Date(m.createdAt).toLocaleString('fr-FR'),
        product: m.product?.name ?? `#${m.productId}`,
        sku: m.product?.sku ?? '',
        location: m.stockLocation?.name ?? `#${m.stockLocationId}`,
        reason: m.reason,
        quantity: qty,
      });
    });

    if (movements.length > 0) {
      sheet.addRow([]);
      totals.forEach((value, key) => {
        const row = sheet.addRow(['', '', '', '', `Total ${key}`, value]);
        row.font = { bold: true };
      });
      const totalRow = sheet.addRow(['', '', '', '', 'Total général', grandTotal]);
      totalRow.font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  private toCreateInput(dto: CreateStockMovementDto): Prisma.StockMovementCreateInput {
    if (!Number.isInteger(dto?.productId) || dto.productId <= 0) {
      throw new BadRequestException('productId must be a positive integer');
    }

    if (!Number.isInteger(dto?.stockLocationId) || dto.stockLocationId <= 0) {
      throw new BadRequestException('stockLocationId must be a positive integer');
    }

    if (!Number.isFinite(dto.quantityDelta) || dto.quantityDelta === 0) {
      throw new BadRequestException('quantityDelta must be a non-zero number');
    }

    if (!Number.isInteger(dto.quantityDelta)) {
      throw new BadRequestException('quantityDelta must be an integer');
    }

    let createdAt: Date | undefined;
    if (dto.createdAt) {
      const parsed = new Date(dto.createdAt);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException('createdAt must be a valid date');
      }
      createdAt = parsed;
    }

    return {
      product: { connect: { id: dto.productId } },
      stockLocation: { connect: { id: dto.stockLocationId } },
      quantityDelta: dto.quantityDelta,
      reason: dto.reason ?? 'UNKNOWN',
      sourceDocumentType: dto.sourceDocumentType,
      sourceDocumentId: dto.sourceDocumentId,
      ...(createdAt ? { createdAt } : {}),
    };
  }
}
