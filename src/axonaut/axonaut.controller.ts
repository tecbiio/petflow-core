import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AxonautConfigDto,
  AxonautClearPendingInvoicesDto,
  AxonautLookupDto,
  AxonautMarkInvoicesImportedDto,
  AxonautSyncStockDto,
  AxonautSyncInvoicesDto,
  AxonautTestRequestDto,
  AxonautUpdateStockDto,
} from './axonaut.dto';
import { AxonautService } from './axonaut.service';

@Controller('axonaut')
export class AxonautController {
  constructor(private readonly axonautService: AxonautService) {}

  @Post('config')
  setConfig(@Body() dto: AxonautConfigDto) {
    this.axonautService.setConfig(dto);
    return { ok: true };
  }

  @Get('config')
  async getConfig() {
    return this.axonautService.getPublicConfig();
  }

  @Post('update-stock')
  updateStock(@Body() dto: AxonautUpdateStockDto) {
    return this.axonautService.updateStock(dto);
  }

  @Post('sync-stock')
  syncStock(@Body() dto: AxonautSyncStockDto) {
    return this.axonautService.syncStock(dto);
  }

  @Post('lookup')
  lookup(@Body() dto: AxonautLookupDto) {
    return this.axonautService.lookup(dto);
  }

  @Post('test-request')
  testRequest(@Body() dto: AxonautTestRequestDto) {
    return this.axonautService.testRequest(dto);
  }

  @Post('import-products')
  importProducts() {
    return this.axonautService.importProducts();
  }

  @Get('invoices')
  listInvoices(@Query('limit') limit?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.axonautService.listInvoices({
      limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      from,
      to,
    });
  }

  @Get('invoices/:invoiceId/lines')
  invoiceLines(@Param('invoiceId') invoiceId: string) {
    return this.axonautService.getInvoiceLines(invoiceId);
  }

  @Post('invoices/sync')
  syncInvoices(@Body() dto: AxonautSyncInvoicesDto) {
    return this.axonautService.syncInvoices(dto);
  }

  @Get('invoices/pending')
  pendingInvoices() {
    return this.axonautService.getPendingInvoices();
  }

  @Post('invoices/clear-pending')
  clearPendingInvoices(@Body() dto: AxonautClearPendingInvoicesDto) {
    return this.axonautService.clearPendingInvoices(dto);
  }

  @Post('invoices/mark-imported')
  markInvoicesImported(@Body() dto: AxonautMarkInvoicesImportedDto) {
    return this.axonautService.markInvoicesImported(dto);
  }
}
