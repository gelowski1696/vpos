import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ChatService } from './chat.service';

class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('message')
  async streamMessage(
    @Req() req: Request & { user?: { company_id?: string } },
    @Body() body: ChatMessageDto,
    @Res() res: Response
  ): Promise<void> {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }

    if (!body?.message?.trim()) {
      throw new BadRequestException('message is required');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const chunk of this.chatService.streamResponse(
        companyId,
        body.message.trim()
      )) {
        const escaped = chunk.replace(/\n/g, '\\n');
        res.write(`data: ${escaped}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.write(`data: [ERROR] ${message}\n\n`);
    } finally {
      res.end();
    }
  }
}
