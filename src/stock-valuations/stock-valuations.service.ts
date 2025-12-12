import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type StockValuationPoint = {
  valuationDate: Date;
  totalValueCts: number;
  currency: string;
  scope: 'ALL' | 'LOCATION';
  stockLocationId: number | null;
  persisted: boolean;
};

type CachedValuation = {
  valuationDate: Date;
  scopeKey: string;
  stockLocationId: number | null;
  totalValueCts: number;
  currency: string;
};

@Injectable()
export class StockValuationsService {
  private readonly logger = new Logger(StockValuationsService.name);
  private readonly currency = 'EUR';

  constructor(private readonly prisma: PrismaService) {}

  async getDaily(days: number, stockLocationId?: number | null): Promise<StockValuationPoint[]> {
    const prisma = this.prisma.client();
    const dayCount = this.normalizeDays(days);
    const todayStart = this.startOfDay(new Date());
    const fromDate = this.addDays(todayStart, -(dayCount - 1));
    const endDateExclusive = this.addDays(todayStart, 1);

    const locations = await prisma.stockLocation.findMany({ select: { id: true } });
    const locationIds = locations.map((l) => l.id);

    if (stockLocationId !== undefined && stockLocationId !== null && !locationIds.includes(stockLocationId)) {
      throw new BadRequestException(`Emplacement ${stockLocationId} introuvable`);
    }

    const priceMap = await this.buildPriceMap();
    const scopeKeys = this.requiredScopeKeys(locationIds);

    const cached = await this.loadCachedValuations(fromDate, endDateExclusive, scopeKeys);

    for (const day of this.daysBetween(fromDate, endDateExclusive)) {
      const missingScopes = scopeKeys.filter((scope) => !cached.has(this.cacheKey(day, scope)));
      if (missingScopes.length === 0) continue;

      const computed = await this.computeDayValues(day, priceMap, locationIds, {
        useNowIfToday: this.isSameDay(day, todayStart),
      });
      await this.persistDayValuations(day, computed.perLocation, computed.total, locationIds, missingScopes);
      this.cacheDayValuations(cached, day, computed.perLocation, computed.total, locationIds, missingScopes);
    }

    const points: StockValuationPoint[] = [];
    for (const day of this.daysBetween(fromDate, endDateExclusive)) {
      const scopeKey = stockLocationId ? this.scopeKey(stockLocationId) : this.allScopeKey();
      const scope: StockValuationPoint['scope'] = stockLocationId ? 'LOCATION' : 'ALL';

      const stored = cached.get(this.cacheKey(day, scopeKey));
      points.push({
        valuationDate: stored?.valuationDate ?? day,
        totalValueCts: stored?.totalValueCts ?? 0,
        currency: stored?.currency ?? this.currency,
        scope,
        stockLocationId: stockLocationId ?? null,
        persisted: Boolean(stored),
      });
    }

    return points;
  }

  private async loadCachedValuations(
    fromDate: Date,
    endExclusive: Date,
    scopeKeys: string[],
  ): Promise<Map<string, CachedValuation>> {
    const prisma = this.prisma.client();
    const history = await prisma.dailyStockValuation.findMany({
      where: {
        valuationDate: {
          gte: fromDate,
          lt: endExclusive,
        },
        scopeKey: { in: scopeKeys },
      },
    });

    const cache = new Map<string, CachedValuation>();
    for (const val of history) {
      cache.set(this.cacheKey(this.startOfDay(val.valuationDate), val.scopeKey), {
        valuationDate: this.startOfDay(val.valuationDate),
        scopeKey: val.scopeKey,
        stockLocationId: val.stockLocationId ?? null,
        totalValueCts: val.totalValueCts,
        currency: val.currency ?? this.currency,
      });
    }
    return cache;
  }

  private async computeDayValues(
    dayStart: Date,
    priceMap: Map<number, number>,
    locationIds: number[],
    opts: { useNowIfToday: boolean },
  ): Promise<{ perLocation: Map<number, number>; total: number }> {
    const cutoff = opts.useNowIfToday && this.isSameDay(dayStart, this.startOfDay(new Date()))
      ? new Date()
      : this.endOfDay(dayStart);

    const prisma = this.prisma.client();
    const perLocation = new Map<number, number>();
    for (const id of locationIds) perLocation.set(id, 0);

    const inventories = await prisma.inventory.findMany({
      where: { createdAt: { lte: cutoff } },
      select: { productId: true, stockLocationId: true, quantity: true, createdAt: true },
    });

    const lastInventoryByKey = new Map<
      string,
      { productId: number; stockLocationId: number; quantity: number; createdAt: Date }
    >();
    for (const inv of inventories) {
      const key = this.inventoryKey(inv.stockLocationId, inv.productId);
      const existing = lastInventoryByKey.get(key);
      if (!existing || inv.createdAt > existing.createdAt) {
        lastInventoryByKey.set(key, inv);
      }
    }

    const movements = await prisma.stockMovement.findMany({
      where: { createdAt: { lte: cutoff } },
      select: { productId: true, stockLocationId: true, quantityDelta: true, createdAt: true },
    });

    const deltaByKey = new Map<string, number>();
    for (const move of movements) {
      const key = this.inventoryKey(move.stockLocationId, move.productId);
      const lastInventory = lastInventoryByKey.get(key);
      if (!lastInventory || move.createdAt > lastInventory.createdAt) {
        deltaByKey.set(key, (deltaByKey.get(key) ?? 0) + move.quantityDelta);
      }
    }

    const keys = new Set<string>([...lastInventoryByKey.keys(), ...deltaByKey.keys()]);
    let totalValueCts = 0;

    for (const key of keys) {
      const [locStr, productStr] = key.split(':');
      const locationId = Number(locStr);
      const productId = Number(productStr);
      const base = lastInventoryByKey.get(key)?.quantity ?? 0;
      const delta = deltaByKey.get(key) ?? 0;
      const quantity = base + delta;
      const priceCts = priceMap.get(productId) ?? 0;
      const value = quantity * priceCts;

      perLocation.set(locationId, (perLocation.get(locationId) ?? 0) + value);
      totalValueCts += value;
    }

    return { perLocation, total: totalValueCts };
  }

  private async persistDayValuations(
    dayStart: Date,
    perLocation: Map<number, number>,
    totalValueCts: number,
    locationIds: number[],
    scopesToPersist?: string[],
  ) {
    const prisma = this.prisma.client();
    const valuationDate = this.startOfDay(dayStart);
    const allowedScopes = new Set(scopesToPersist ?? this.requiredScopeKeys(locationIds));
    const entries = [
      {
        scopeKey: this.allScopeKey(),
        stockLocationId: null as number | null,
        totalValueCts,
      },
      ...locationIds.map((id) => ({
        scopeKey: this.scopeKey(id),
        stockLocationId: id,
        totalValueCts: perLocation.get(id) ?? 0,
      })),
    ].filter((entry) => allowedScopes.has(entry.scopeKey));

    if (entries.length === 0) return;

    const ops = entries.map((entry) =>
      prisma.dailyStockValuation.upsert({
        where: {
          valuationDate_scopeKey: {
            valuationDate,
            scopeKey: entry.scopeKey,
          },
        },
        update: {
          totalValueCts: entry.totalValueCts,
          stockLocationId: entry.stockLocationId,
          currency: this.currency,
          computedAt: new Date(),
        },
        create: {
          valuationDate,
          scopeKey: entry.scopeKey,
          stockLocationId: entry.stockLocationId,
          totalValueCts: entry.totalValueCts,
          currency: this.currency,
        },
      }),
    );

    await prisma.$transaction(ops);
  }

  private cacheDayValuations(
    cache: Map<string, CachedValuation>,
    dayStart: Date,
    perLocation: Map<number, number>,
    totalValueCts: number,
    locationIds: number[],
    scopesToUpdate?: string[],
  ) {
    const valuationDate = this.startOfDay(dayStart);
    const allowedScopes = new Set(scopesToUpdate ?? this.requiredScopeKeys(locationIds));
    if (allowedScopes.has(this.allScopeKey())) {
      cache.set(this.cacheKey(valuationDate, this.allScopeKey()), {
        valuationDate,
        scopeKey: this.allScopeKey(),
        stockLocationId: null,
        totalValueCts,
        currency: this.currency,
      });
    }
    for (const id of locationIds) {
      if (!allowedScopes.has(this.scopeKey(id))) continue;
      cache.set(this.cacheKey(valuationDate, this.scopeKey(id)), {
        valuationDate,
        scopeKey: this.scopeKey(id),
        stockLocationId: id,
        totalValueCts: perLocation.get(id) ?? 0,
        currency: this.currency,
      });
    }
  }

  private requiredScopeKeys(locationIds: number[]): string[] {
    return [this.allScopeKey(), ...locationIds.map((id) => this.scopeKey(id))];
  }

  private async buildPriceMap(): Promise<Map<number, number>> {
    const prisma = this.prisma.client();
    const products = await prisma.product.findMany({ select: { id: true, purchasePrice: true } });
    const map = new Map<number, number>();
    for (const product of products) {
      map.set(product.id, this.toCents(product.purchasePrice));
    }
    return map;
  }

  private toCents(value: Prisma.Decimal | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const asNumber = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(asNumber)) return 0;
    return Math.round(asNumber * 100);
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private daysBetween(startInclusive: Date, endExclusive: Date): Date[] {
    const days: Date[] = [];
    for (let cursor = this.startOfDay(startInclusive); cursor < endExclusive; cursor = this.addDays(cursor, 1)) {
      days.push(new Date(cursor));
    }
    return days;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private scopeKey(stockLocationId: number): string {
    return `loc:${stockLocationId}`;
  }

  private allScopeKey(): string {
    return 'all';
  }

  private cacheKey(date: Date, scopeKey: string): string {
    return `${this.startOfDay(date).getTime()}|${scopeKey}`;
  }

  private inventoryKey(stockLocationId: number, productId: number): string {
    return `${stockLocationId}:${productId}`;
  }

  private normalizeDays(raw: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('days doit être un entier positif');
    }
    const rounded = Math.floor(value);
    const max = 90;
    if (rounded > max) {
      this.logger.warn(`Tronquage à ${max} jours pour limiter la charge (demande: ${rounded})`);
    }
    return Math.min(rounded, max);
  }
}
