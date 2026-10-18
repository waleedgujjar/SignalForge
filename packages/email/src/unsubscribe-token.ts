import { createHmac } from 'node:crypto';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function generateUnsubscribeToken(campaignId: string, leadId: string, secret: string): string {
  const payload = `${campaignId}:${leadId}`;
  const sig = sign(payload, secret);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyUnsubscribeToken(token: string, secret: string): { campaignId: string; leadId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;

    const campaignId = parts[0]!;
    const leadId = parts[1]!;
    const sig = parts[2]!;
    const expected = sign(`${campaignId}:${leadId}`, secret);
    if (sig !== expected) return null;

    return { campaignId, leadId };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(apiUrl: string, campaignId: string, leadId: string, secret: string): string {
  const token = generateUnsubscribeToken(campaignId, leadId, secret);
  return `${apiUrl}/unsubscribe?token=${token}`;
}
