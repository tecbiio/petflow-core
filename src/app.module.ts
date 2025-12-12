import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { StockLocationsModule } from './stock-locations/stock-locations.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { InventoriesModule } from './inventories/inventories.module';
import { StockModule } from './stock/stock.module';
import { HusseModule } from './husse/husse.module';
import { AxonautModule } from './axonaut/axonaut.module';
import { DocumentsModule } from './documents/documents.module';
import { AuthModule } from './auth/auth.module';
import { PackagingsModule } from './packagings/packagings.module';
import { FamiliesModule } from './families/families.module';
import { StockValuationsModule } from './stock-valuations/stock-valuations.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ProductsModule,
    StockLocationsModule,
    StockMovementsModule,
    InventoriesModule,
    StockModule,
    HusseModule,
    AxonautModule,
    DocumentsModule,
    PackagingsModule,
    FamiliesModule,
    StockValuationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
