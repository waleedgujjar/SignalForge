# SignalForge — Environment Variables Reference

## Application

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `NODE_ENV` | Yes | `development` | No | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | No | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `APP_URL` | Yes | `http://localhost:3000` | No | Frontend URL (used for CORS, email links, OAuth callbacks) |
| `API_URL` | Yes | `http://localhost:4000` | No | Backend API URL. On Vercel: set to VPS API URL (server-side only) |
| `WEB_PORT` | No | `3000` | No | Next.js server port |
| `API_PORT` | No | `4000` | No | Fastify server port |

## Database

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `DATABASE_URL` | Yes | — | No | PostgreSQL connection string |
| `POSTGRES_USER` | Docker | `signalforge` | No | Docker compose postgres user |
| `POSTGRES_PASSWORD` | Docker | — | No | Docker compose postgres password |
| `POSTGRES_DB` | Docker | `signalforge` | No | Docker compose database name |
| `PG_POOL_MAX` | No | `25` | No | Maximum Prisma connection pool size |

## Redis

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `REDIS_URL` | Yes | — | No | Redis connection string (include password) |
| `REDIS_PASSWORD` | Docker | — | No | Docker compose redis password |

## Security

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `SESSION_SECRET` | Yes | — | No | HMAC signing key for sessions and tokens. Min 32 chars. Generate: `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | Yes | — | No | AES-256-GCM key for credential encryption. Min 32 chars. Generate: `openssl rand -base64 48` |

## System Email (Transactional)

Used for password resets and email verification. If not configured, these features log warnings but don't block other functionality.

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `SMTP_HOST` | No | — | No | SMTP server hostname |
| `SMTP_PORT` | No | `587` | No | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | No | — | No | SMTP authentication username |
| `SMTP_PASS` | No | — | No | SMTP authentication password |
| `SMTP_FROM_EMAIL` | No | — | No | From address for system emails |
| `SMTP_FROM_NAME` | No | `SignalForge` | No | From display name |

## AI Provider

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `AI_PROVIDER` | No | `mock` | No | `mock` (no external calls) or `openai` |
| `OPENAI_API_KEY` | If openai | — | No | OpenAI/compatible API key |
| `OPENAI_BASE_URL` | No | — | No | Custom endpoint (FreeLLMAPI, OpenRouter) |
| `OPENAI_MODEL` | No | `gpt-4o` | No | Model name (or `auto` for FreeLLMAPI) |

## OAuth

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `GOOGLE_CLIENT_ID` | No | — | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | — | No | Google OAuth redirect URI |
| `MICROSOFT_CLIENT_ID` | No | — | No | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | No | — | No | Microsoft OAuth client secret |

## Email Verification

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `EMAIL_VERIFICATION_ENABLED` | No | `true` | No | Enable email verification module |
| `EMAIL_VERIFICATION_SMTP_ENABLED` | No | `true` | No | Enable SMTP-level verification |
| `EMAIL_VERIFICATION_CACHE_TTL_DAYS` | No | `7` | No | Cache duration for verification results |
| `EMAIL_VERIFICATION_SMTP_TIMEOUT_MS` | No | `10000` | No | SMTP verification timeout |
| `EMAIL_VERIFICATION_SMTP_MAX_RETRIES` | No | `2` | No | Max retry attempts |
| `EMAIL_VERIFICATION_MAX_CONCURRENCY` | No | `10` | No | Concurrent verification workers |
| `EMAIL_VERIFICATION_PER_DOMAIN_LIMIT` | No | `5` | No | Max concurrent per domain |
| `EMAIL_VERIFICATION_MAX_BULK_SIZE` | No | `10000` | No | Maximum leads per bulk verification |

## Lead Research

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `LINKEDIN_RESEARCH_ENABLED` | No | `false` | No | Enable LinkedIn research module |
| `LINKEDIN_RESEARCH_PROVIDER` | No | `public` | No | `manual`, `public`, or `agent-reach` |
| `LINKEDIN_RESEARCH_MAX_CONCURRENCY` | No | `1` | No | Concurrent research workers |
| `LINKEDIN_RESEARCH_TIMEOUT_MS` | No | `20000` | No | Research operation timeout |

## Lead Discovery

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `GOOGLE_MAPS_SCRAPER_ENABLED` | No | `false` | No | Enable Google Maps scraper |
| `GOOGLE_MAPS_SCRAPER_URL` | No | `http://localhost:8080` | No | Scraper container URL |
| `EMAIL_DISCOVERY_ENABLED` | No | `true` | No | Enable email discovery from websites |
| `EMAIL_DISCOVERY_MAX_CONCURRENCY` | No | `3` | No | Concurrent crawlers |

## Performance / Tuning

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `RATE_LIMIT_MAX` | No | `200` | No | Max requests per minute per IP |

## Frontend

| Variable | Required | Default | Public | Description |
|----------|----------|---------|--------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `/api` | **Yes** | Browser-facing API base URL. For Vercel: always `/api` (same-origin proxy). For local dev: `http://localhost:4000` |

## Deployment-Specific Notes

### Vercel (Frontend)
- `API_URL` must be set as a **server-side** environment variable (not `NEXT_PUBLIC_*`)
- `NEXT_PUBLIC_API_URL` must be `/api` for the rewrite proxy to work
- `APP_URL` should match your Vercel domain

### Hostinger VPS (Backend)
- `API_URL=http://api:4000` — internal Docker network address
- `APP_URL` must be your Vercel frontend URL (used for CORS allow-origin)
- All secrets (`SESSION_SECRET`, `ENCRYPTION_KEY`, passwords) must be unique and strong
