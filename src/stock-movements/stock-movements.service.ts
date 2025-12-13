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
      const reasons = filter.reasons.flatMap((reason) =>
        reason === StockMovementReason.INCONNU ? [StockMovementReason.INCONNU, 'UNKNOWN'] : [reason],
      );
      where.OR = reasons.map((reason) => ({ reason: { startsWith: reason } }));
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
    const reasons = [StockMovementReason.DON, StockMovementReason.POUBELLE, StockMovementReason.PERSO];

    const movements = await prisma.stockMovement.findMany({
      where: { OR: reasons.map((reason) => ({ reason: { startsWith: reason } })) },
      orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Synthèse');
    sheet.columns = [
      { key: 'sku', width: 18 },
      { key: 'product', width: 36 },
      { key: 'unitPrice', width: 16, style: { numFmt: '#,##0.00 "€"' } },
      { key: 'donQty', width: 10 },
      { key: 'donAmount', width: 12, style: { numFmt: '#,##0.00 "€"' } },
      { key: 'poubelleQty', width: 10 },
      { key: 'poubelleAmount', width: 14, style: { numFmt: '#,##0.00 "€"' } },
      { key: 'persoQty', width: 10 },
      { key: 'persoAmount', width: 12, style: { numFmt: '#,##0.00 "€"' } },
      { key: 'totalQty', width: 10 },
      { key: 'totalAmount', width: 12, style: { numFmt: '#,##0.00 "€"' } },
    ];

    sheet.views = [{ state: 'frozen', ySplit: 2 }];

    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF3F4F6' } };
    const headerBorder = {
      top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
    };

    sheet.addRow([
      'Code produit',
      'Libellé produit',
      'Prix unitaire HT (€)',
      'Don',
      null,
      'Poubelle',
      null,
      'Perso',
      null,
      'Total',
      null,
    ]);
    sheet.addRow([
      null,
      null,
      null,
      'Quantité',
      'Prix HT (€)',
      'Quantité',
      'Prix HT (€)',
      'Quantité',
      'Prix HT (€)',
      'Quantité',
      'Prix HT (€)',
    ]);

    sheet.mergeCells('A1:A2');
    sheet.mergeCells('B1:B2');
    sheet.mergeCells('C1:C2');
    sheet.mergeCells('D1:E1');
    sheet.mergeCells('F1:G1');
    sheet.mergeCells('H1:I1');
    sheet.mergeCells('J1:K1');

    for (const rowIndex of [1, 2]) {
      const row = sheet.getRow(rowIndex);
      row.font = { bold: true };
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.eachCell((cell) => {
        cell.fill = headerFill;
        cell.border = headerBorder;
      });
    }

    sheet.getRow(1).height = 20;
    sheet.getRow(2).height = 18;

    type SummaryRow = {
      sku: string;
      product: string;
      unitPrice: number;
      unitPriceCts: number;
      donQty: number;
      donAmountCts: number;
      poubelleQty: number;
      poubelleAmountCts: number;
      persoQty: number;
      persoAmountCts: number;
    };

    const byProduct = new Map<number, SummaryRow>();

    for (const movement of movements) {
      const productId = movement.productId;
      const sku = movement.product?.sku ?? '';
      const label = movement.product?.name ?? `Produit #${productId}`;
      const qty = Math.abs(movement.quantityDelta);
      const reasonKey = reasons.find((reason) => movement.reason.startsWith(reason));
      if (!reasonKey) continue;

      const rawUnitPrice = movement.product ? Number(movement.product.purchasePrice) : 0;
      const unitPrice = Number.isFinite(rawUnitPrice) ? rawUnitPrice : 0;
      const unitPriceCts = Math.round(unitPrice * 100);

      const current =
        byProduct.get(productId) ??
        ({
          sku,
          product: label,
          unitPrice,
          unitPriceCts,
          donQty: 0,
          donAmountCts: 0,
          poubelleQty: 0,
          poubelleAmountCts: 0,
          persoQty: 0,
          persoAmountCts: 0,
        } satisfies SummaryRow);

      if (reasonKey === StockMovementReason.DON) {
        current.donQty += qty;
        current.donAmountCts += unitPriceCts * qty;
      }
      if (reasonKey === StockMovementReason.POUBELLE) {
        current.poubelleQty += qty;
        current.poubelleAmountCts += unitPriceCts * qty;
      }
      if (reasonKey === StockMovementReason.PERSO) {
        current.persoQty += qty;
        current.persoAmountCts += unitPriceCts * qty;
      }

      byProduct.set(productId, current);
    }

    const rows = Array.from(byProduct.values()).sort((a, b) => a.sku.localeCompare(b.sku, 'fr', { numeric: true }));

    let totalDonQty = 0;
    let totalPoubelleQty = 0;
    let totalPersoQty = 0;
    let totalDonAmountCts = 0;
    let totalPoubelleAmountCts = 0;
    let totalPersoAmountCts = 0;

    rows.forEach((row) => {
      const totalQty = row.donQty + row.poubelleQty + row.persoQty;
      const totalAmountCts = row.donAmountCts + row.poubelleAmountCts + row.persoAmountCts;

      totalDonQty += row.donQty;
      totalPoubelleQty += row.poubelleQty;
      totalPersoQty += row.persoQty;
      totalDonAmountCts += row.donAmountCts;
      totalPoubelleAmountCts += row.poubelleAmountCts;
      totalPersoAmountCts += row.persoAmountCts;

      sheet.addRow({
        sku: row.sku,
        product: row.product,
        unitPrice: row.unitPrice,
        donQty: row.donQty,
        donAmount: row.donAmountCts / 100,
        poubelleQty: row.poubelleQty,
        poubelleAmount: row.poubelleAmountCts / 100,
        persoQty: row.persoQty,
        persoAmount: row.persoAmountCts / 100,
        totalQty,
        totalAmount: totalAmountCts / 100,
      });
    });

    const grandTotalQty = totalDonQty + totalPoubelleQty + totalPersoQty;
    const grandTotalAmountCts = totalDonAmountCts + totalPoubelleAmountCts + totalPersoAmountCts;
    const totalRow = sheet.addRow({
      sku: '',
      product: 'TOTAL',
      unitPrice: '',
      donQty: totalDonQty,
      donAmount: totalDonAmountCts / 100,
      poubelleQty: totalPoubelleQty,
      poubelleAmount: totalPoubelleAmountCts / 100,
      persoQty: totalPersoQty,
      persoAmount: totalPersoAmountCts / 100,
      totalQty: grandTotalQty,
      totalAmount: grandTotalAmountCts / 100,
    });
    totalRow.font = { bold: true };

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
      reason: dto.reason ?? StockMovementReason.INCONNU,
      sourceDocumentType: dto.sourceDocumentType,
      sourceDocumentId: dto.sourceDocumentId,
      ...(createdAt ? { createdAt } : {}),
    };
  }
}
