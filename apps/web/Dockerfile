# SignalForge Web — Multi-stage production build (Next.js standalone)
# Build context: monorepo root (docker-compose sets context: .)
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy workspace structure for dependency installation (layer cache)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/allocation/package.json packages/allocation/
COPY packages/analytics/package.json packages/analytics/
COPY packages/auth/package.json packages/auth/
COPY packages/automations/package.json packages/automations/
COPY packages/campaigns/package.json packages/campaigns/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/deliverability/package.json packages/deliverability/
COPY packages/email/package.json packages/email/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/inbound/package.json packages/inbound/
COPY packages/inbox/package.json packages/inbox/
COPY packages/integrations/package.json packages/integrations/
COPY packages/lead-discovery/package.json packages/lead-discovery/
COPY packages/lead-research/package.json packages/lead-research/
COPY packages/mailboxes/package.json packages/mailboxes/
COPY packages/queue/package.json packages/queue/
COPY packages/sending/package.json packages/sending/
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/validation/package.json packages/validation/
COPY packages/verification/package.json packages/verification/
COPY packages/warmup/package.json packages/warmup/
COPY packages/website-scanner/package.json packages/website-scanner/
COPY workers/analytics-worker/package.json workers/analytics-worker/
COPY workers/campaign-enrollment-worker/package.json workers/campaign-enrollment-worker/
COPY workers/deliverability-worker/package.json workers/deliverability-worker/
COPY workers/email-worker/package.json workers/email-worker/
COPY workers/enrichment-worker/package.json workers/enrichment-worker/
COPY workers/inbound-worker/package.json workers/inbound-worker/
COPY workers/inbox-reply-worker/package.json workers/inbox-reply-worker/
COPY workers/lead-discovery-worker/package.json workers/lead-discovery-worker/
COPY workers/lead-research-worker/package.json workers/lead-research-worker/
COPY workers/scheduler-worker/package.json workers/scheduler-worker/
COPY workers/verification-worker/package.json workers/verification-worker/
COPY workers/warmup-worker/package.json workers/warmup-worker/
COPY workers/website-worker/package.json workers/website-worker/
COPY workers/workflow-worker/package.json workers/workflow-worker/

RUN pnpm install --frozen-lockfile

# ── Build stage ──────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY . .

# NEXT_PUBLIC_API_URL is baked into the client bundle at build time
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN pnpm db:generate
RUN pnpm --filter @signalforge/web... build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next.js standalone output includes only what's needed
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
