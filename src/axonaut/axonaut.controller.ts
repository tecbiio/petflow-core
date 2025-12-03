import { Body, Controller, Get, Post } from '@nestjs/common';
import { AxonautConfigDto, AxonautLookupDto, AxonautUpdateStockDto } from './axonaut.dto';
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
  getConfig() {
    return this.axonautService.getConfig();
  }

  @Post('update-stock')
  updateStock(@Body() dto: AxonautUpdateStockDto) {
    return this.axonautService.updateStock(dto);
  }

  @Post('lookup')
  lookup(@Body() dto: AxonautLookupDto) {
    return this.axonautService.lookup(dto);
  }
}
