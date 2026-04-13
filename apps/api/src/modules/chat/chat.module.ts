import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [ChatController],
  providers: [ChatService]
})
export class ChatModule {}
