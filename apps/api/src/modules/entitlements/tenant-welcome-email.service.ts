import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export type TenantWelcomeEmailInput = {
  toEmail: string;
  tenantName: string;
  tenantCode: string;
  clientId: string;
  adminEmail: string;
  adminPassword: string;
  loginUrl: string;
};

export type TenantWelcomeEmailResult = {
  sent: boolean;
  recipient: string | null;
  skippedReason: string | null;
  error: string | null;
};

@Injectable()
export class TenantWelcomeEmailService {
  private readonly logger = new Logger(TenantWelcomeEmailService.name);
  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  async sendTenantWelcomeEmail(input: TenantWelcomeEmailInput): Promise<TenantWelcomeEmailResult> {
    const recipient = input.toEmail.trim().toLowerCase();
    if (!recipient || !TenantWelcomeEmailService.EMAIL_REGEX.test(recipient)) {
      return {
        sent: false,
        recipient: recipient || null,
        skippedReason: 'invalid_recipient_email',
        error: null
      };
    }

    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    if (!resendApiKey) {
      return {
        sent: false,
        recipient,
        skippedReason: 'resend_api_key_missing',
        error: null
      };
    }

    const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || 'VPOS <onboarding@vmjamtech.com>';
    const logoUrl = this.resolveLogoUrl();
    const subject = `Welcome to VPOS, ${input.tenantName}`;
    const textBody = [
      `Welcome to VPOS, ${input.tenantName}!`,
      '',
      'Your tenant setup is ready.',
      `Tenant Code: ${input.tenantCode}`,
      `Client ID: ${input.clientId}`,
      '',
      'Login Credentials',
      `Email: ${input.adminEmail}`,
      `Password: ${input.adminPassword}`,
      '',
      `Login here: ${input.loginUrl}`,
      '',
      'For security, we recommend changing this password after first login.'
    ].join('\n');

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; padding: 24px;">
        <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="padding: 24px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
            <img src="${logoUrl}" alt="VPOS Logo" style="height: 42px; width: auto; display: block;" />
            <h1 style="margin: 14px 0 0; font-size: 22px; line-height: 1.3; color: #0f172a;">Welcome to VPOS</h1>
            <p style="margin: 8px 0 0; font-size: 14px; color: #334155;">Your tenant workspace is now ready.</p>
          </div>
          <div style="padding: 24px;">
            <p style="margin: 0 0 12px; font-size: 14px;">Hi ${this.escapeHtml(input.tenantName)},</p>
            <p style="margin: 0 0 18px; font-size: 14px;">
              Thanks for subscribing. Your VPOS tenant has been provisioned successfully.
            </p>

            <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 16px; background: #f8fafc;">
              <div style="font-size: 12px; color: #475569; margin-bottom: 8px;">Tenant Details</div>
              <div style="font-size: 14px;"><strong>Tenant Code:</strong> ${this.escapeHtml(input.tenantCode)}</div>
              <div style="font-size: 14px;"><strong>Client ID:</strong> ${this.escapeHtml(input.clientId)}</div>
            </div>

            <div style="border: 1px solid #dbeafe; border-radius: 10px; padding: 14px; margin-bottom: 16px; background: #eff6ff;">
              <div style="font-size: 12px; color: #1e3a8a; margin-bottom: 8px;">Login Credentials</div>
              <div style="font-size: 14px;"><strong>Email:</strong> ${this.escapeHtml(input.adminEmail)}</div>
              <div style="font-size: 14px;"><strong>Password:</strong> ${this.escapeHtml(input.adminPassword)}</div>
            </div>

            <a href="${this.escapeHtml(input.loginUrl)}" style="display: inline-block; text-decoration: none; background: #2563eb; color: #ffffff; font-weight: 700; border-radius: 8px; padding: 11px 16px;">
              Login to VPOS
            </a>

            <p style="margin: 16px 0 0; font-size: 12px; color: #475569;">
              For security, please change your password after your first successful login.
            </p>
          </div>
        </div>
      </div>
    `;

    const attachment = await this.tryLoadLogoAttachment();
    const body: Record<string, unknown> = {
      from: fromAddress,
      to: [recipient],
      subject,
      html: htmlBody,
      text: textBody
    };
    if (attachment) {
      body.attachments = [attachment];
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const raw = await response.text();
        const errorText = `resend_send_failed_${response.status}${raw ? `: ${raw.slice(0, 300)}` : ''}`;
        this.logger.warn(errorText);
        return {
          sent: false,
          recipient,
          skippedReason: 'resend_send_failed',
          error: errorText
        };
      }

      return {
        sent: true,
        recipient,
        skippedReason: null,
        error: null
      };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`resend_send_error: ${errorText}`);
      return {
        sent: false,
        recipient,
        skippedReason: 'resend_send_error',
        error: errorText
      };
    }
  }

  private resolveLogoUrl(): string {
    const explicit = process.env.VPOS_EMAIL_LOGO_URL?.trim();
    if (explicit) {
      return explicit;
    }
    const base = process.env.VPOS_WEB_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
    if (!base) {
      return 'https://vmjamtech.com/logo.png';
    }
    const normalizedBase = base.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${normalizedBase}/logo.png`;
  }

  private async tryLoadLogoAttachment(): Promise<{ filename: string; content: string } | null> {
    const candidates = [
      resolve(process.cwd(), 'apps/web/public/logo.png'),
      resolve(process.cwd(), 'public/logo.png'),
      resolve(process.cwd(), 'apps/mobile/assests/vpos_logo.png')
    ];

    for (const filePath of candidates) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 2 * 1024 * 1024) {
          continue;
        }
        const bin = await fs.readFile(filePath);
        if (!bin.length) {
          continue;
        }
        return {
          filename: 'vpos-logo.png',
          content: bin.toString('base64')
        };
      } catch {
        // Continue with the next candidate.
      }
    }

    return null;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
