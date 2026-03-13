import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MobileEnrollmentController } from './mobile-enrollment.controller';
import { MobileEnrollmentService } from './mobile-enrollment.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MobileEnrollmentController],
  providers: [MobileEnrollmentService]
})
export class MobileEnrollmentModule {}
