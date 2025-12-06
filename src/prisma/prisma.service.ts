import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

type TenantContext = {
  tenantId: number;
  tenantCode: string;
  dbUrl: string;
  userId?: number;
};

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly context = new AsyncLocalStorage<TenantContext>();
  private readonly clients = new Map<string, PrismaClient>();

  runWithTenant<T>(ctx: TenantContext, callback: () => T): T {
    return this.context.run(ctx, callback);
  }

  client(): PrismaClient {
    const ctx = this.context.getStore();
    if (!ctx?.dbUrl) {
      throw new Error('Contexte tenant manquant : aucune base tenant sélectionnée');
    }
    let client = this.clients.get(ctx.dbUrl);
    if (!client) {
      client = new PrismaClient({ datasources: { db: { url: ctx.dbUrl } } });
      this.clients.set(ctx.dbUrl, client);
    }
    return client;
  }

  getCurrentTenant(): TenantContext | undefined {
    return this.context.getStore();
  }

  async onModuleDestroy() {
    await Promise.all(
      Array.from(this.clients.values()).map((client) =>
        client
          .$disconnect()
          .catch(() => undefined),
      ),
    );
  }
}
