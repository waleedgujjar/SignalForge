import { connect as netConnect } from 'node:net';
import { isBlockedHostname, resolveSafeAddresses } from './network-guard.js';
import type { SmtpInternalStatus } from './types.js';

export interface SmtpVerifyOptions {
  timeoutMs?: number;
  mailFrom?: string;
  heloHost?: string;
}

export interface SmtpVerifyResult {
  status: SmtpInternalStatus;
  response?: string;
}

const domainLastCheck = new Map<string, number>();
const DOMAIN_RATE_MS = 200;

export async function verifySmtpRecipient(
  email: string,
  mailServer: string,
  options: SmtpVerifyOptions = {},
): Promise<SmtpVerifyResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const mailFrom = options.mailFrom ?? 'verify@signalforge.local';
  const heloHost = options.heloHost ?? 'signalforge.local';

  if (!mailServer || isBlockedHostname(mailServer)) {
    return { status: 'BLOCKED' };
  }

  const safeIps = await resolveSafeAddresses(mailServer);
  if (mailServer !== safeIps[0] && safeIps.length === 0 && !mailServer.includes('.')) {
    return { status: 'BLOCKED' };
  }

  const host = mailServer;
  const now = Date.now();
  const last = domainLastCheck.get(host) ?? 0;
  if (now - last < DOMAIN_RATE_MS) {
    await sleep(DOMAIN_RATE_MS - (now - last));
  }
  domainLastCheck.set(host, Date.now());

  return attemptSmtp(host, email, mailFrom, heloHost, timeoutMs, 0);
}

async function attemptSmtp(
  host: string,
  email: string,
  mailFrom: string,
  heloHost: string,
  timeoutMs: number,
  attempt: number,
): Promise<SmtpVerifyResult> {
  try {
    const lines = await smtpDialog(host, email, mailFrom, heloHost, timeoutMs);
    const rcptLine = lines.find((l) => l.startsWith('250') || l.startsWith('251'));
    const rejectLine = lines.find((l) => /^5\d\d/.test(l));
    const tempLine = lines.find((l) => /^4\d\d/.test(l));

    if (rcptLine) return { status: 'ACCEPTED', response: rcptLine };
    if (rejectLine) return { status: 'REJECTED', response: rejectLine };
    if (tempLine) return { status: 'TEMPORARY_FAILURE', response: tempLine };
    return { status: 'UNKNOWN', response: lines.join(' | ') };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return { status: 'TIMEOUT' };
    }
    if (message.includes('ECONNREFUSED') || message.includes('blocked')) {
      return { status: 'BLOCKED' };
    }
    if (attempt < 1) {
      await sleep(500);
      return attemptSmtp(host, email, mailFrom, heloHost, timeoutMs, attempt + 1);
    }
    return { status: 'UNKNOWN' };
  }
}

function smtpDialog(
  host: string,
  email: string,
  mailFrom: string,
  heloHost: string,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const responses: string[] = [];
    let buffer = '';
    let step = 0;
    const commands = [`EHLO ${heloHost}`, `MAIL FROM:<${mailFrom}>`, `RCPT TO:<${email}>`, 'QUIT'];

    const socket = netConnect({ host, port: 25, timeout: timeoutMs });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP timeout'));
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        responses.push(line);
        if (/^\d{3} /.test(line)) {
          const code = Number(line.slice(0, 3));
          if (step === 0 && code === 220) {
            socket.write(`${commands[step]}\r\n`);
            step++;
          } else if (step > 0 && step < commands.length && code >= 200 && code < 400) {
            if (step === commands.length - 1) {
              clearTimeout(timer);
              socket.end();
              resolve(responses);
              return;
            }
            socket.write(`${commands[step]}\r\n`);
            step++;
          } else if (code >= 400) {
            clearTimeout(timer);
            socket.end();
            resolve(responses);
          }
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('timeout', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error('SMTP timeout'));
    });
  });
}

export async function detectCatchAll(
  domain: string,
  mailServer: string,
  options: SmtpVerifyOptions = {},
): Promise<boolean> {
  const probe = `random-verification-${Math.random().toString(16).slice(2, 10)}@${domain}`;
  const result = await verifySmtpRecipient(probe, mailServer, options);
  return result.status === 'ACCEPTED';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
