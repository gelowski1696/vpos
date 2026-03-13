import { IsHexColor, IsOptional, IsString } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  companyLogo?: string | null;

  @IsOptional()
  @IsString()
  logoLight?: string | null;

  @IsOptional()
  @IsString()
  logoDark?: string | null;

  @IsOptional()
  @IsString()
  receiptLogo?: string | null;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  receiptFooterText?: string;

  @IsOptional()
  @IsString()
  invoiceNumberFormat?: string;

  @IsOptional()
  @IsString()
  officialNumberFormat?: string;
}
