import { connect as netConnect } from 'node:net';
import { hostname as osHostname } from 'node:os';
import { isBlockedHostname, resolveSafeAddresses } from './network-guard.js';
import type { SmtpInternalStatus } from './types.js';

export interface SmtpVerifyOptions {
  timeoutMs?: number;
  mailFrom?: string;
  heloHost?: string;
  /** Also RCPT a random address in the same session to detect catch-all domains. */
  probeCatchAll?: boolean;
  /** Max MX hosts to try when a host cannot be reached. */
  maxHosts?: number;
}

export type SmtpStage = 'connect' | 'banner' | 'ehlo' | 'mail' | 'rcpt';

export interface SmtpVerifyResult {
  status: SmtpInternalStatus;
  /** Last SMTP reply relevant to the verdict, for display and debugging. */
  response?: string;
  /** Mail host that produced the verdict. */
  host?: string;
  stage?: SmtpStage;
  /** Set when the catch-all probe ran: true if a random address was accepted too. */
  catchAll?: boolean;
}

interface Reply {
  code: number;
  text: string;
}

const domainLastCheck = new Map<string, number>();
const DOMAIN_RATE_MS = 200;

// Many VPS providers block outbound port 25. When connections to several
// different mail hosts all fail at the TCP level, stop trying for a while
// instead of burning a full timeout on every address.
//
// Individual servers failing is normal (tarpitting, delayed greetings, dead
// hosts), so this only trips when NO mail server has answered recently: one
// successful session proves the port is open, and a few slow small-business
// hosts must not switch mailbox checks off for every other address.
const UNREACHABLE_THRESHOLD = 5;
const UNREACHABLE_COOLDOWN_MS = 10 * 60 * 1000;
const REACHABLE_PROOF_MS = 30 * 60 * 1000;
const unreachableHosts = new Set<string>();
let smtpUnavailableUntil = 0;
let lastReachableAt = 0;

export function isSmtpUnavailable(): boolean {
  return Date.now() < smtpUnavailableUntil;
}

export function resetSmtpStateForTests(): void {
  unreachableHosts.clear();
  smtpUnavailableUntil = 0;
  lastReachableAt = 0;
  domainLastCheck.clear();
}

/** @internal Exported for tests. */
export function noteReachable(now: number = Date.now()): void {
  unreachableHosts.clear();
  smtpUnavailableUntil = 0;
  lastReachableAt = now;
}

/** @internal Exported for tests. */
export function noteUnreachable(host: string, now: number = Date.now()): void {
  if (now - lastReachableAt < REACHABLE_PROOF_MS) return;
  unreachableHosts.add(host);
  if (unreachableHosts.size >= UNREACHABLE_THRESHOLD) {
    smtpUnavailableUntil = now + UNREACHABLE_COOLDOWN_MS;
    unreachableHosts.clear();
  }
}

export function defaultHeloHost(): string {
  const configured = process.env.EMAIL_VERIFICATION_HELO_HOST?.trim();
  if (configured) return configured;
  const host = osHostname();
  return host.includes('.') ? host : 'localhost';
}

export async function verifySmtpRecipient(
  email: string,
  mailServers: string | string[],
  options: SmtpVerifyOptions = {},
): Promise<SmtpVerifyResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  // Null reverse-path (RFC 5321 4.5.5) is the standard sender for address
  // probes and is not rejected for having an unresolvable domain.
  const mailFrom = options.mailFrom ?? process.env.EMAIL_VERIFICATION_MAIL_FROM?.trim() ?? '';
  const heloHost = options.heloHost ?? defaultHeloHost();
  const hosts = (Array.isArray(mailServers) ? mailServers : [mailServers])
    .filter((h) => h && !isBlockedHostname(h))
    .slice(0, options.maxHosts ?? 2);

  if (hosts.length === 0) return { status: 'BLOCKED', stage: 'connect' };
  if (isSmtpUnavailable()) return { status: 'UNAVAILABLE', stage: 'connect' };

  const domain = email.slice(email.lastIndexOf('@') + 1);
  const probe = options.probeCatchAll
    ? `sf-probe-${Math.random().toString(36).slice(2, 12)}@${domain}`
    : null;

  let last: SmtpVerifyResult = { status: 'UNAVAILABLE', stage: 'connect' };
  for (const host of hosts) {
    const safeIps = await resolveSafeAddresses(host);
    if (safeIps.length === 0) {
      last = { status: 'BLOCKED', stage: 'connect', host };
      continue;
    }

    await paceHost(host);
    let session: SessionResult;
    try {
      session = await smtpSession(safeIps[0]!, heloHost, mailFrom, email, probe, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      noteUnreachable(host);
      last = {
        status: /timeout|ETIMEDOUT/i.test(message) ? 'TIMEOUT' : 'UNAVAILABLE',
        stage: 'connect',
        host,
        response: message,
      };
      continue; // try the next MX host
    }

    noteReachable();
    return interpretSession(session, host);
  }

  if (last.stage === 'connect' && last.status === 'TIMEOUT') {
    // Every host timed out before replying: indistinguishable from a blocked port.
    return { ...last, status: isSmtpUnavailable() ? 'UNAVAILABLE' : 'TIMEOUT' };
  }
  return last;
}

/** Kept for callers that only need the catch-all signal. */
export async function detectCatchAll(
  domain: string,
  mailServer: string,
  options: SmtpVerifyOptions = {},
): Promise<boolean> {
  const probe = `sf-probe-${Math.random().toString(36).slice(2, 12)}@${domain}`;
  const result = await verifySmtpRecipient(probe, mailServer, { ...options, probeCatchAll: false });
  return result.status === 'ACCEPTED';
}

interface SessionResult {
  failedAt?: { stage: Exclude<SmtpStage, 'connect' | 'rcpt'>; reply: Reply };
  rcpt?: Reply;
  probe?: Reply;
}

function interpretSession(session: SessionResult, host: string): SmtpVerifyResult {
  if (session.failedAt) {
    // A refusal before RCPT is about us (IP reputation, missing PTR, policy),
    // never about the recipient's mailbox.
    const { stage, reply } = session.failedAt;
    return {
      status: reply.code >= 500 ? 'BLOCKED' : 'TEMPORARY_FAILURE',
      stage,
      host,
      response: formatReply(reply),
    };
  }

  const rcpt = session.rcpt;
  if (!rcpt) return { status: 'UNKNOWN', stage: 'rcpt', host };

  const status = classifyRcptReply(rcpt);
  const result: SmtpVerifyResult = { status, stage: 'rcpt', host, response: formatReply(rcpt) };
  if (status === 'ACCEPTED' && session.probe) {
    result.catchAll = session.probe.code === 250 || session.probe.code === 251;
  }
  return result;
}

const MAILBOX_MISSING =
  /user unknown|unknown user|no such (user|mailbox|recipient)|does not exist|doesn't exist|not exist|invalid (recipient|mailbox|address)|recipient (rejected|not found|unknown|address rejected)|unknown recipient|mailbox (unavailable|not found)|address rejected|not a valid|undeliverable|no mailbox|account (is )?(disabled|inactive)/i;
const MAILBOX_FULL = /mailbox (is )?full|over ?quota|quota exceeded|insufficient storage/i;
const POLICY_BLOCK =
  /spamhaus|blocked|block list|blocklist|blacklist|black list|reputation|policy|denied|not permitted|refused|rbl|spam|access denied|relay/i;

export function classifyRcptReply(reply: Reply): SmtpInternalStatus {
  const { code, text } = reply;
  if (code === 250 || code === 251) return 'ACCEPTED';

  const enhanced = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(text);
  const cls = enhanced ? `${enhanced[2]}.${enhanced[3]}` : null;

  if (code === 552 || code === 452 || cls === '2.2' || MAILBOX_FULL.test(text)) return 'MAILBOX_FULL';

  if (code >= 500) {
    // Microsoft 365 Directory-Based Edge Blocking: the recipient is not in the
    // tenant's directory. The text says "Access denied" but it means "no such user".
    if (cls === '4.1' && /AS\(201806281\)|recipient address rejected/i.test(text)) return 'REJECTED';
    if (enhanced?.[2] === '7' || (!cls?.startsWith('1.') && POLICY_BLOCK.test(text))) return 'BLOCKED';
    // X.1.x is the addressing class: bad mailbox, bad domain, ambiguous, etc.
    // X.2.1 is "mailbox disabled". Both mean this address will not receive mail.
    if (cls?.startsWith('1.') || cls === '2.1') return 'REJECTED';
    if ((code === 550 || code === 551 || code === 553) && MAILBOX_MISSING.test(text)) return 'REJECTED';
    // An unexplained 5xx is not proof the mailbox is missing.
    return 'UNKNOWN';
  }
  if (code >= 400) return 'TEMPORARY_FAILURE';
  return 'UNKNOWN';
}

function formatReply(reply: Reply): string {
  return `${reply.code} ${reply.text}`.trim().slice(0, 300);
}

async function paceHost(host: string): Promise<void> {
  const last = domainLastCheck.get(host) ?? 0;
  const wait = DOMAIN_RATE_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  domainLastCheck.set(host, Date.now());
}

/**
 * Runs EHLO → MAIL FROM → RCPT (address) → [RCPT (probe)] → QUIT and records
 * the reply to each step. Rejects only for connection-level failures, i.e.
 * when the server never sent a greeting.
 */
function smtpSession(
  ip: string,
  heloHost: string,
  mailFrom: string,
  email: string,
  probe: string | null,
  timeoutMs: number,
): Promise<SessionResult> {
  return new Promise((resolve, reject) => {
    const result: SessionResult = {};
    let greeted = false;
    let settled = false;
    let buffer = '';
    let lines: string[] = [];
    type Step = 'banner' | 'ehlo' | 'helo' | 'mail' | 'rcpt' | 'probe' | 'quit';
    let step: Step = 'banner';

    const socket = netConnect({ host: ip, port: 25 });
    socket.setTimeout(timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!socket.destroyed) {
        if (greeted && step !== 'quit') socket.write('QUIT\r\n');
        socket.end();
        setTimeout(() => socket.destroy(), 1000).unref();
      }
      if (err && !greeted) reject(err);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('SMTP timeout')), timeoutMs + 2000);

    const send = (next: Step, command: string) => {
      step = next;
      socket.write(`${command}\r\n`);
    };

    const onReply = (reply: Reply) => {
      const ok = reply.code >= 200 && reply.code < 400;
      switch (step) {
        case 'banner':
          greeted = true;
          if (!ok) {
            result.failedAt = { stage: 'banner', reply };
            return finish();
          }
          return send('ehlo', `EHLO ${heloHost}`);
        case 'ehlo':
          // Fall back to HELO for servers that do not speak ESMTP.
          if (!ok) return send('helo', `HELO ${heloHost}`);
          return send('mail', `MAIL FROM:<${mailFrom}>`);
        case 'helo':
          if (!ok) {
            result.failedAt = { stage: 'ehlo', reply };
            return finish();
          }
          return send('mail', `MAIL FROM:<${mailFrom}>`);
        case 'mail':
          if (!ok) {
            result.failedAt = { stage: 'mail', reply };
            return finish();
          }
          return send('rcpt', `RCPT TO:<${email}>`);
        case 'rcpt':
          result.rcpt = reply;
          if (probe && (reply.code === 250 || reply.code === 251)) {
            return send('probe', `RCPT TO:<${probe}>`);
          }
          send('quit', 'QUIT');
          return finish();
        case 'probe':
          result.probe = reply;
          send('quit', 'QUIT');
          return finish();
        default:
          return finish();
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (!line) continue;
        lines.push(line);
        // Multi-line replies use "250-"; the final line uses "250 ".
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m) continue;
        if (m[2] === ' ') {
          const text = lines.map((l) => l.slice(4)).join(' ').trim();
          lines = [];
          onReply({ code: Number(m[1]), text });
          if (settled) return;
        }
      }
    });
    socket.on('timeout', () => finish(new Error('SMTP timeout')));
    socket.on('error', (err) => finish(err));
    socket.on('close', () => finish(new Error('SMTP connection closed')));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
