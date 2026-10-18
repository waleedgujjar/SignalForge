import { z } from 'zod';

const aiProviderSchema = z.enum(['mock', 'openai']);

/// Strict boolean parser: treats "true"/"1" as true, everything else as false.
/// All boolean flags use this parser to avoid the z.coerce.boolean() pitfall
/// where Boolean("false") === true in JavaScript.
const strictBooleanFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    });

/// `.env.example` ships keys as `KEY=`; an empty string must behave like "unset".
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  AI_PROVIDER: aiProviderSchema.default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  EMAIL_VERIFICATION_ENABLED: strictBooleanFlag(true),
  EMAIL_VERIFICATION_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  EMAIL_VERIFICATION_SMTP_ENABLED: strictBooleanFlag(true),
  EMAIL_VERIFICATION_SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EMAIL_VERIFICATION_SMTP_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  EMAIL_VERIFICATION_MAX_CONCURRENCY: z.coerce.number().int().positive().default(10),
  EMAIL_VERIFICATION_PER_DOMAIN_LIMIT: z.coerce.number().int().positive().default(5),
  EMAIL_VERIFICATION_MAX_BULK_SIZE: z.coerce.number().int().positive().default(10000),
  // ─── Lead Research (Module 17) ────────────────────────────────────────────
  // Off by default. Only researcher-provided URLs are ever looked at.
  LINKEDIN_RESEARCH_ENABLED: strictBooleanFlag(false),
  LINKEDIN_RESEARCH_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['manual', 'public', 'agent-reach']).default('public'),
  ),
  LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED: strictBooleanFlag(true),
  LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED: strictBooleanFlag(false),
  LINKEDIN_RESEARCH_MAX_CONCURRENCY: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(1)),
  LINKEDIN_RESEARCH_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(20_000)),
  LINKEDIN_RESEARCH_MAX_ATTEMPTS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(2)),
  LINKEDIN_RESEARCH_MAX_BATCH_SIZE: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(50)),
  AGENT_REACH_BIN: z.preprocess(emptyToUndefined, z.string().default('agent-reach')),
  AGENT_REACH_HEALTH_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(15_000)),
  JINA_READER_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('https://r.jina.ai')),
  JINA_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  // ─── Web Research (Stage 11) ──────────────────────────────────────────────
  WEB_RESEARCH_ENABLED: strictBooleanFlag(false),
  WEB_RESEARCH_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(30_000)),
  WEB_RESEARCH_MAX_PAGES: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(20).default(5)),
  WEB_RESEARCH_AI_INTERPRETATION_ENABLED: strictBooleanFlag(false),

  // ─── Lead Discovery — Google Maps Scraper ──────────────────────────────────
  GOOGLE_MAPS_SCRAPER_ENABLED: strictBooleanFlag(false),
  GOOGLE_MAPS_SCRAPER_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://localhost:8080')),
  GOOGLE_MAPS_SCRAPER_MAX_TIME: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(120)),
  GOOGLE_MAPS_SCRAPER_DEPTH: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10).default(1)),
  GOOGLE_MAPS_SCRAPER_POLL_INTERVAL_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(3_000)),
  GOOGLE_MAPS_SCRAPER_MAX_POLL_ATTEMPTS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(120)),

  // ─── System Email (transactional: password resets, email verification) ──────
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  SMTP_FROM_NAME: z.preprocess(emptyToUndefined, z.string().default('SignalForge')),

  // ─── Performance / Tuning ──────────────────────────────────────────────────────
  PG_POOL_MAX: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).default(25)),
  RATE_LIMIT_MAX: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(200)),

  // ─── Email Discovery ──────────────────────────────────────────────────────────
  EMAIL_DISCOVERY_ENABLED: strictBooleanFlag(true),
  EMAIL_DISCOVERY_MAX_CONCURRENCY: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(3)),
  EMAIL_DISCOVERY_MAX_PAGES: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10).default(3)),
  EMAIL_DISCOVERY_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(10_000)),
  EMAIL_DISCOVERY_PATTERN_INFERENCE: strictBooleanFlag(false),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function getEnv(): Env {
  return loadEnv();
}
