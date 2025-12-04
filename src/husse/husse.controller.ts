import { Body, Controller, Get, Post } from '@nestjs/common';
import { HusseConfigDto, HusseFetchDto, HusseLoginDto } from './husse.dto';
import { HusseService } from './husse.service';

@Controller('husse')
export class HusseController {
  constructor(private readonly husseService: HusseService) {}

  @Post('login')
  async login(@Body() dto: HusseLoginDto) {
    await this.husseService.login(dto);
    return { ok: true };
  }

  @Post('config')
  setConfig(@Body() dto: HusseConfigDto) {
    this.husseService.setConfig(dto);
    return { ok: true };
  }

  @Get('config')
  getConfig() {
    return this.husseService.getConfig();
  }

  @Get('session')
  session() {
    return this.husseService.sessionStatus();
  }

  @Post('fetch')
  async fetch(@Body() dto: HusseFetchDto) {
    const result = await this.husseService.fetchPages(dto);
    return result;
  }

  @Post('logout')
  logout() {
    this.husseService.clearCookie();
    return { ok: true };
  }
}
