import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(
    @Headers('x-client-id') clientId: string | undefined,
    @Headers('x-vpos-client') vposClient: string | undefined,
    @Body() dto: LoginDto
  ): Promise<{
    access_token: string;
    refresh_token: string;
    access_expires_in: string;
    refresh_expires_in: string;
    client_id: string;
    must_change_password: boolean;
  }> {
    return this.authService.login(dto.email, dto.password, dto.device_id, clientId, {
      mobileChannel: this.isMobileClient(vposClient)
    });
  }

  @Public()
  @Post('refresh')
  refresh(
    @Headers('x-vpos-client') vposClient: string | undefined,
    @Body() dto: RefreshDto
  ): Promise<{
    access_token: string;
    refresh_token: string;
    access_expires_in: string;
    refresh_expires_in: string;
    must_change_password?: boolean;
  }> {
    return this.authService.refresh(dto.refresh_token, {
      mobileChannel: this.isMobileClient(vposClient)
    });
  }

  @Public()
  @Post('logout')
  logout(
    @Headers('x-vpos-client') vposClient: string | undefined,
    @Headers('x-vpos-auth-action') vposAuthAction: string | undefined,
    @Body() dto: LogoutDto
  ): Promise<{ success: true }> {
    return this.authService.logout(dto.refresh_token, {
      mobileChannel: this.isMobileClient(vposClient),
      authAction: vposAuthAction
    });
  }

  @Post('change-password')
  changePassword(
    @Req()
    req: {
      user?: { sub?: string; company_id?: string };
    },
    @Body() dto: ChangePasswordDto
  ): Promise<{ success: true }> {
    return this.authService.changePassword({
      userId: String(req.user?.sub ?? '').trim(),
      companyId: String(req.user?.company_id ?? '').trim(),
      currentPassword: dto.current_password,
      newPassword: dto.new_password
    });
  }

  private isMobileClient(value: string | undefined): boolean {
    return (value ?? '').trim().toLowerCase() === 'mobile';
  }
}
