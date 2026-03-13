import { Body, Controller, Post } from '@nestjs/common';

@Controller('printing')
export class PrintingController {
  @Post('test')
  test(@Body() body: { device_id: string; printer_type: string }): { ok: true; queued_at: string } {
    void body;
    return { ok: true, queued_at: new Date().toISOString() };
  }
}
