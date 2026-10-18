import { loadEnv } from '@signalforge/config';
import { createSmtpProvider } from '@signalforge/email';
import type { EmailProvider } from '@signalforge/email';

let cachedProvider: EmailProvider | null = null;

function getSystemEmailProvider(): EmailProvider | null {
  if (cachedProvider) return cachedProvider;

  const env = loadEnv();
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM_EMAIL) {
    return null;
  }

  cachedProvider = createSmtpProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    username: env.SMTP_USER,
    password: env.SMTP_PASS,
    encryption: env.SMTP_PORT === 465 ? 'SSL' : 'TLS',
    fromEmail: env.SMTP_FROM_EMAIL,
    fromName: env.SMTP_FROM_NAME,
  });

  return cachedProvider;
}

export function isSystemEmailConfigured(): boolean {
  return getSystemEmailProvider() !== null;
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const provider = getSystemEmailProvider();
  if (!provider) return false;

  const env = loadEnv();
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await provider.send({
    to,
    subject: 'Reset your SignalForge password',
    body: `You requested a password reset.\n\nClick this link to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request this, ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Reset your password</h2>
        <p>You requested a password reset for your SignalForge account.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">Reset Password</a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
      </div>
    `,
  });

  return true;
}

export async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  const provider = getSystemEmailProvider();
  if (!provider) return false;

  const env = loadEnv();
  const verifyUrl = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  await provider.send({
    to,
    subject: 'Verify your SignalForge email',
    body: `Please verify your email address.\n\nClick this link:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Verify your email</h2>
        <p>Please verify your email address for your SignalForge account.</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">Verify Email</a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours.</p>
      </div>
    `,
  });

  return true;
}
