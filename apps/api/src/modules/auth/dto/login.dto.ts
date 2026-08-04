import { IsEmail, IsString, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @ValidateIf((value: LoginDto) => !value.username)
  @IsEmail()
  email?: string;

  @ValidateIf((value: LoginDto) => !value.email)
  @IsString()
  @MinLength(3)
  username?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  device_id!: string;
}
