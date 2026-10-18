import type { MailboxEncryption } from '@/lib/api';

export interface ProviderPreset {
  id: string;
  label: string;
  smtpHost?: string;
  smtpPort?: number;
  encryptionType?: MailboxEncryption;
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    label: 'Custom SMTP',
    hint: 'Enter the SMTP details provided by your email host.',
  },
  {
    id: 'google',
    label: 'Google Workspace',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    encryptionType: 'TLS',
    hint: 'Requires an app password. Two-factor authentication must be enabled.',
  },
  {
    id: 'microsoft365',
    label: 'Microsoft 365',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    encryptionType: 'TLS',
    hint: 'Requires SMTP AUTH to be enabled for the mailbox in the admin center.',
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 587,
    encryptionType: 'TLS',
    hint: 'Use an app password from Zoho Mail settings.',
  },
];
