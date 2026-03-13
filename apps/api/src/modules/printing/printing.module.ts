import { Module } from '@nestjs/common';
import { PrintingController } from './printing.controller';

@Module({
  controllers: [PrintingController]
})
export class PrintingModule {}
