import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { normalizeSmtpError } from './smtp-errors.js';
import type { SmtpErrorCategory } from './smtp-errors.js';

export type MailboxProvider = 'smtp' | 'google_oauth' | 'microsoft_oauth';

export interface VerifyConnectionResult {
  success: boolean;
  errorCategory?: SmtpErrorCategory;
  message?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: 'NONE' | 'TLS' | 'SSL';
  fromEmail: string;
  fromName: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribeUrl?: string;
}

export interface SendEmailResult {
  messageId: string;
  internetMessageId?: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
  verifyConnection(): Promise<VerifyConnectionResult>;
}

export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  const secure = config.encryption === 'SSL';
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    ...(config.encryption === 'TLS' && !secure ? { requireTLS: true } : {}),
  });

  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const headers: Record<string, string> = {};
      if (input.listUnsubscribeUrl) {
        headers['List-Unsubscribe'] = `<${input.listUnsubscribeUrl}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }

      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: input.to,
        subject: input.subject,
        text: input.body,
        html: input.html ?? input.body.replace(/\n/g, '<br>'),
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        ...(input.references?.length ? { references: input.references.join(' ') } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      return {
        messageId: info.messageId ?? `local-${Date.now()}`,
        internetMessageId: info.messageId ?? undefined,
      };
    },
    async verifyConnection(): Promise<VerifyConnectionResult> {
      try {
        await transporter.verify();
        return { success: true };
      } catch (err) {
        const normalized = normalizeSmtpError(err);
        return {
          success: false,
          errorCategory: normalized.category,
          message: normalized.message,
        };
      }
    },
  };
}
