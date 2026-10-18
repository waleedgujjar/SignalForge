/// Agent-Reach adapter: health check + public-path delegation.
///
/// Agent-Reach is a Python CLI "capability layer" with no programmatic API.
/// What SignalForge uses in this release is its `doctor --json` report, which
/// says whether the LinkedIn channel (an MCP server authenticated by a
/// researcher's own browser login) and the web channel (Jina Reader) are set
/// up. Research itself is NOT routed through Agent-Reach: `research*()` steps
/// aside so the chain falls through to the `public` provider (Agent-Reach's
/// own documented fallback for public pages) and finally to manual review.
///
/// The authenticated MCP path is a gated extension point only. SignalForge
/// never reads Agent-Reach's session store (`~/.agent-reach/`,
/// `~/.linkedin-mcp/`), never stores LinkedIn cookies or tokens, and re-scrubs
/// every string the CLI prints before it is persisted or displayed.

import { execFile } from 'node:child_process';

import { getEnv, type Env } from '@signalforge/config';

import { sanitizeDoctorOutput, sanitizeSecrets } from '../../sanitize.js';
import type { ResearchContext, ResearchOutcome } from '../../types.js';
import type { LinkedInResearchProvider } from '../provider.js';
import { failureOutcome } from '../provider.js';
import type { ProviderHealth } from '../types.js';

export const AGENT_REACH_DISPLAY_NAME = 'Agent-Reach';
const DOCTOR_ARGS = ['doctor', '--json'] as const;
const DOCTOR_MAX_BUFFER = 256 * 1024;

// ─── Process execution ────────────────────────────────────────────────────────

export interface ExecFileCallbackError extends Error {
  code?: string | number | null;
  killed?: boolean;
  signal?: string | null;
}

export interface DoctorExecOptions {
  timeout: number;
  windowsHide: boolean;
  maxBuffer: number;
  shell: boolean;
  env: Record<string, string>;
  encoding: 'utf8';
}

export type ExecFileImpl = (
  file: string,
  args: readonly string[],
  options: DoctorExecOptions,
  callback: (error: ExecFileCallbackError | null, stdout: string, stderr: string) => void,
) => void;

const defaultExecFile: ExecFileImpl = (file, args, options, callback) => {
  execFile(file, [...args], options, (error, stdout, stderr) => {
    callback(error as ExecFileCallbackError | null, String(stdout ?? ''), String(stderr ?? ''));
  });
};

/// Windows `.cmd`/`.bat` shims (pipx, npm) can only be started through the
/// shell; a real `.exe` or a POSIX binary must not be, so the constant
/// argument list is never re-parsed by a shell.
export function shouldUseShell(bin: string): boolean {
  return /\.(cmd|bat)$/i.test(bin);
}

/// Minimal child environment: enough to find the binary and for Python to
/// start (Windows Python aborts without SYSTEMROOT; `.cmd` shims need COMSPEC
/// and PATHEXT), and nothing else — no DATABASE_URL, no JINA_API_KEY.
const CHILD_ENV_KEYS = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
] as const;

export function buildDoctorEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  return env;
}

export type DoctorRun =
  | { kind: 'not_installed'; message: string }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'report'; exitCode: number | null; stdout: string; stderr: string }
  | { kind: 'error'; message: string };

export interface RunDoctorOptions {
  timeoutMs: number;
  execFileImpl?: ExecFileImpl;
  processEnv?: NodeJS.ProcessEnv;
}

export function runDoctor(bin: string, options: RunDoctorOptions): Promise<DoctorRun> {
  const execFileImpl = options.execFileImpl ?? defaultExecFile;
  const execOptions: DoctorExecOptions = {
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: DOCTOR_MAX_BUFFER,
    shell: shouldUseShell(bin),
    env: buildDoctorEnv(options.processEnv),
    encoding: 'utf8',
  };

  return new Promise<DoctorRun>((resolve) => {
    try {
      execFileImpl(bin, DOCTOR_ARGS, execOptions, (error, stdout, stderr) => {
        if (!error) {
          resolve({ kind: 'report', exitCode: 0, stdout, stderr });
          return;
        }
        if (error.code === 'ENOENT') {
          resolve({ kind: 'not_installed', message: `Executable "${bin}" was not found` });
          return;
        }
        if (error.killed || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
          resolve({ kind: 'timeout', timeoutMs: options.timeoutMs });
          return;
        }
        // A missing `.cmd` shim surfaces as exit 1 with a shell message.
        if (!stdout.trim() && /not recognized|not found|no such file|cannot find/i.test(stderr)) {
          resolve({ kind: 'not_installed', message: `Executable "${bin}" was not found` });
          return;
        }
        // Non-zero exit with output is still a report — doctor exits non-zero
        // when channels are unhealthy, which is exactly what we want to read.
        if (stdout.trim()) {
          resolve({ kind: 'report', exitCode: typeof error.code === 'number' ? error.code : null, stdout, stderr });
          return;
        }
        resolve({ kind: 'error', message: sanitizeSecrets(error.message) });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ kind: 'error', message: sanitizeSecrets(message) });
    }
  });
}

// ─── Report parsing ───────────────────────────────────────────────────────────

export type DoctorChannelStatus = 'ok' | 'warn' | 'off' | 'error';

export interface DoctorChannel {
  status: DoctorChannelStatus;
  name?: string;
  message?: string;
  tier?: number;
  backends?: string[];
  active_backend?: string | null;
}

/// Only the two channels this module cares about are kept; the other 14 are
/// irrelevant here and are dropped before anything is persisted.
export interface DoctorReport {
  linkedin?: DoctorChannel;
  web?: DoctorChannel;
}

const CHANNEL_STATUSES = new Set<string>(['ok', 'warn', 'off', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toChannel(value: unknown): DoctorChannel | undefined {
  if (!isRecord(value)) return undefined;
  const status = typeof value.status === 'string' ? value.status.toLowerCase() : '';
  if (!CHANNEL_STATUSES.has(status)) return undefined;
  const channel: DoctorChannel = { status: status as DoctorChannelStatus };
  if (typeof value.name === 'string') channel.name = value.name;
  if (typeof value.message === 'string') channel.message = value.message;
  if (typeof value.tier === 'number') channel.tier = value.tier;
  if (Array.isArray(value.backends)) {
    channel.backends = value.backends.filter((backend): backend is string => typeof backend === 'string');
  }
  if (typeof value.active_backend === 'string' || value.active_backend === null) {
    channel.active_backend = value.active_backend;
  }
  return channel;
}

/// `agent-reach doctor --json` prints one JSON object keyed by channel id.
/// Banner lines before/after are tolerated by slicing to the outermost braces.
export function parseDoctorJson(stdout: string): DoctorReport | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const report: DoctorReport = {};
  const linkedin = toChannel(parsed.linkedin);
  const web = toChannel(parsed.web);
  if (linkedin) report.linkedin = linkedin;
  if (web) report.web = web;
  return report;
}

/// Fallback for the human-readable `doctor` output (older versions, or a
/// build that ignores `--json`): one line per channel with a status marker.
export function parseDoctorText(output: string): DoctorReport | null {
  const report: DoctorReport = {};
  for (const rawLine of output.split(/\r?\n/)) {
    const line = sanitizeSecrets(rawLine);
    const lower = line.toLowerCase();
    const status = textLineStatus(line);
    if (!status) continue;
    if (lower.includes('linkedin') && !report.linkedin) {
      report.linkedin = { status, message: line.trim() };
    } else if ((lower.includes('web') || lower.includes('jina') || line.includes('任意网页')) && !report.web) {
      report.web = { status, message: line.trim() };
    }
  }
  return report.linkedin || report.web ? report : null;
}

function textLineStatus(line: string): DoctorChannelStatus | null {
  if (/✅|✓|\[ok\]|\bok\b|已配置/i.test(line)) return 'ok';
  if (/⚠|\[!\]|\bwarn(ing)?\b/i.test(line)) return 'warn';
  if (/❌|\[x\]|not configured|\boff\b|未配置|未安装/i.test(line)) return 'off';
  if (/\berror\b|failed|失败/i.test(line)) return 'error';
  return null;
}

/// Map a report to health. The web channel (Jina Reader) is what this phase
/// actually uses, so it decides READY; the LinkedIn channel only tells the
/// settings page whether a researcher-authenticated MCP session exists.
export function mapDoctorReport(
  report: DoctorReport,
  options: { checkedAt: string; exitCode?: number | null },
): Pick<ProviderHealth, 'status' | 'authentication' | 'details'> & { checkedAt: string } {
  const { linkedin, web } = report;
  const status: ProviderHealth['status'] = web?.status === 'ok' ? 'READY' : 'UNAVAILABLE';
  const authentication: ProviderHealth['authentication'] =
    linkedin && (linkedin.status === 'ok' || linkedin.status === 'warn') ? 'CONFIGURED' : 'NOT_CONFIGURED';

  const lines: string[] = [];
  if (web) {
    lines.push(`Web (${web.name ?? 'web'}): ${web.status}${web.active_backend ? ` via ${web.active_backend}` : ''}`);
  } else {
    lines.push('Web channel: not reported');
  }
  if (linkedin) {
    const backends = linkedin.backends && linkedin.backends.length > 0 ? ` — backends: ${linkedin.backends.join(', ')}` : '';
    lines.push(`LinkedIn (${linkedin.name ?? 'linkedin'}): ${linkedin.status}${backends}`);
    if (linkedin.status === 'off') lines.push('LinkedIn MCP not configured — public pages only');
    if (linkedin.status === 'warn') lines.push('LinkedIn MCP configured but not verified');
    if (linkedin.status === 'error') lines.push('LinkedIn MCP inspection failed');
    if (linkedin.message) lines.push(linkedin.message);
  } else {
    lines.push('LinkedIn channel: not reported');
  }
  if (options.exitCode != null && options.exitCode !== 0) lines.push(`doctor exited with code ${options.exitCode}`);

  return { status, authentication, checkedAt: options.checkedAt, details: sanitizeDoctorOutput(lines.join('\n')) };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

type EnvSource = Env | (() => Env);

export interface AgentReachProviderOptions {
  execFileImpl?: ExecFileImpl;
  env?: EnvSource;
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
}

export class AgentReachProvider implements LinkedInResearchProvider {
  readonly name = 'agent-reach' as const;
  readonly displayName = AGENT_REACH_DISPLAY_NAME;

  private readonly execFileImpl: ExecFileImpl | undefined;
  private readonly envSource: EnvSource;
  private readonly now: () => Date;
  private readonly processEnv: NodeJS.ProcessEnv | undefined;

  constructor(options: AgentReachProviderOptions = {}) {
    this.execFileImpl = options.execFileImpl;
    this.envSource = options.env ?? getEnv;
    this.now = options.now ?? (() => new Date());
    this.processEnv = options.processEnv;
  }

  private readEnv(): Env | null {
    try {
      return typeof this.envSource === 'function' ? this.envSource() : this.envSource;
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    const env = this.readEnv();
    return Boolean(env && env.LINKEDIN_RESEARCH_ENABLED && env.LINKEDIN_RESEARCH_PROVIDER === 'agent-reach');
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.now().toISOString();
    const env = this.readEnv();
    if (!env) return this.health('UNAVAILABLE', 'NOT_CONFIGURED', checkedAt, ['Environment configuration could not be loaded']);

    const run = await runDoctor(env.AGENT_REACH_BIN, {
      timeoutMs: env.AGENT_REACH_HEALTH_TIMEOUT_MS,
      execFileImpl: this.execFileImpl,
      processEnv: this.processEnv,
    });

    switch (run.kind) {
      case 'not_installed':
        return this.health('NEEDS_SETUP', 'NOT_CONFIGURED', checkedAt, [
          'Agent-Reach is not installed on the API/worker host',
          'Install it in an isolated virtualenv and point AGENT_REACH_BIN at the executable',
        ]);
      case 'timeout':
        return this.health('UNAVAILABLE', 'NOT_CONFIGURED', checkedAt, [
          `agent-reach doctor did not finish within ${run.timeoutMs} ms`,
        ]);
      case 'error':
        return this.health('UNAVAILABLE', 'NOT_CONFIGURED', checkedAt, [
          'agent-reach doctor could not be executed',
          ...sanitizeDoctorOutput(run.message).slice(0, 3),
        ]);
      case 'report': {
        // JSON first — it is the documented contract; the text scan only
        // covers builds that ignore `--json`.
        const report = parseDoctorJson(run.stdout) ?? parseDoctorText(run.stdout) ?? parseDoctorText(run.stderr);
        if (!report) {
          return this.health('UNAVAILABLE', 'NOT_CONFIGURED', checkedAt, [
            'agent-reach doctor output could not be parsed',
            ...sanitizeDoctorOutput(run.stdout || run.stderr).slice(0, 5),
          ]);
        }
        const mapped = mapDoctorReport(report, { checkedAt, exitCode: run.exitCode });
        return this.health(mapped.status, mapped.authentication, checkedAt, mapped.details);
      }
    }
  }

  private health(
    status: ProviderHealth['status'],
    authentication: ProviderHealth['authentication'],
    checkedAt: string,
    details: string[],
  ): ProviderHealth {
    return { provider: this.name, displayName: this.displayName, status, authentication, checkedAt, details };
  }

  async researchCompany(_input: unknown, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.research(ctx);
  }

  async researchPerson(_input: unknown, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.research(ctx);
  }

  /// Steps aside with a non-retryable UNAVAILABLE so `shouldContinueChain`
  /// moves on to `public`, then `manual`. The reason is recorded in
  /// `chainNotes` so the manual-review record explains itself.
  private async research(ctx: ResearchContext): Promise<ResearchOutcome> {
    const env = this.readEnv();
    if (env?.LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED) return this.researchViaMcp(ctx);
    ctx.chainNotes.push(
      'Agent-Reach LinkedIn requires a researcher-authenticated session (LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED=false); only public pages can be read',
    );
    return failureOutcome(
      this.name,
      'UNAVAILABLE',
      'PROVIDER_NOT_CONFIGURED',
      'Agent-Reach LinkedIn requires a researcher-authenticated session; falling back to public pages or manual verification',
      false,
    );
  }

  /// Gated extension point for the authenticated `linkedin-mcp-server` path.
  ///
  /// HARD RULE if this is ever implemented: bind READ tools only —
  /// `get_person_profile` and `get_company_profile`. The upstream server also
  /// exposes `connect_with_person`, `send_message`, `get_inbox` and similar
  /// action tools; none of them may ever be called from SignalForge. Reading
  /// must happen one profile at a time against a researcher-supplied URL, with
  /// the session owned by the researcher (never stored here), and any refusal
  /// (auth expired, rate limit) must end the job rather than be retried.
  protected async researchViaMcp(ctx: ResearchContext): Promise<ResearchOutcome> {
    ctx.chainNotes.push('Agent-Reach MCP research path is not implemented in this release');
    return failureOutcome(
      this.name,
      'UNAVAILABLE',
      'PROVIDER_UNAVAILABLE',
      'Agent-Reach MCP research is not implemented in this release',
      false,
    );
  }
}

export const agentReachProvider = new AgentReachProvider();
