import { loadEnv } from '@signalforge/config';
import {
  generateUnsubscribeToken as generate,
  verifyUnsubscribeToken as verify,
  buildUnsubscribeUrl as buildUrl,
} from '@signalforge/email';

export function generateUnsubscribeToken(campaignId: string, leadId: string): string {
  return generate(campaignId, leadId, loadEnv().SESSION_SECRET);
}

export function verifyUnsubscribeToken(token: string): { campaignId: string; leadId: string } | null {
  return verify(token, loadEnv().SESSION_SECRET);
}

export function buildUnsubscribeUrl(campaignId: string, leadId: string): string {
  const env = loadEnv();
  return buildUrl(env.API_URL, campaignId, leadId, env.SESSION_SECRET);
}
