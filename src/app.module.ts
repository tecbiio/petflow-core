import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { StockLocationsModule } from './stock-locations/stock-locations.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { InventoriesModule } from './inventories/inventories.module';
import { StockModule } from './stock/stock.module';

@Module({
  imports: [
    PrismaModule,
    ProductsModule,
    StockLocationsModule,
    StockMovementsModule,
    InventoriesModule,
    StockModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
