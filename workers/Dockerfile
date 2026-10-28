# SignalForge Workers — Single image, multiple containers via CMD override
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
COPY workers/import-worker/package.json workers/import-worker/
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

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN pnpm db:generate
RUN pnpm --filter "@signalforge/*" build
RUN pnpm --filter "./workers/**" build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules/.pnpm/node_modules

# Copy dependencies and all built packages + workers
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Shared packages (all workers depend on these)
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/config/package.json ./packages/config/
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/database/src/generated ./packages/database/src/generated
COPY --from=build /app/packages/queue/dist ./packages/queue/dist
COPY --from=build /app/packages/queue/package.json ./packages/queue/
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
COPY --from=build /app/packages/auth/package.json ./packages/auth/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/validation/dist ./packages/validation/dist
COPY --from=build /app/packages/validation/package.json ./packages/validation/
COPY --from=build /app/packages/ai/dist ./packages/ai/dist
COPY --from=build /app/packages/ai/package.json ./packages/ai/
COPY --from=build /app/packages/analytics/dist ./packages/analytics/dist
COPY --from=build /app/packages/analytics/package.json ./packages/analytics/
COPY --from=build /app/packages/allocation/dist ./packages/allocation/dist
COPY --from=build /app/packages/allocation/package.json ./packages/allocation/
COPY --from=build /app/packages/automations/dist ./packages/automations/dist
COPY --from=build /app/packages/automations/package.json ./packages/automations/
COPY --from=build /app/packages/campaigns/dist ./packages/campaigns/dist
COPY --from=build /app/packages/campaigns/package.json ./packages/campaigns/
COPY --from=build /app/packages/deliverability/dist ./packages/deliverability/dist
COPY --from=build /app/packages/deliverability/package.json ./packages/deliverability/
COPY --from=build /app/packages/email/dist ./packages/email/dist
COPY --from=build /app/packages/email/package.json ./packages/email/
COPY --from=build /app/packages/inbound/dist ./packages/inbound/dist
COPY --from=build /app/packages/inbound/package.json ./packages/inbound/
COPY --from=build /app/packages/inbox/dist ./packages/inbox/dist
COPY --from=build /app/packages/inbox/package.json ./packages/inbox/
COPY --from=build /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=build /app/packages/integrations/package.json ./packages/integrations/
COPY --from=build /app/packages/lead-discovery/dist ./packages/lead-discovery/dist
COPY --from=build /app/packages/lead-discovery/package.json ./packages/lead-discovery/
COPY --from=build /app/packages/lead-research/dist ./packages/lead-research/dist
COPY --from=build /app/packages/lead-research/package.json ./packages/lead-research/
COPY --from=build /app/packages/mailboxes/dist ./packages/mailboxes/dist
COPY --from=build /app/packages/mailboxes/package.json ./packages/mailboxes/
COPY --from=build /app/packages/sending/dist ./packages/sending/dist
COPY --from=build /app/packages/sending/package.json ./packages/sending/
COPY --from=build /app/packages/verification/dist ./packages/verification/dist
COPY --from=build /app/packages/verification/package.json ./packages/verification/
COPY --from=build /app/packages/warmup/dist ./packages/warmup/dist
COPY --from=build /app/packages/warmup/package.json ./packages/warmup/
COPY --from=build /app/packages/website-scanner/dist ./packages/website-scanner/dist
COPY --from=build /app/packages/website-scanner/package.json ./packages/website-scanner/

# All worker dist directories
COPY --from=build /app/workers/email-worker/dist ./workers/email-worker/dist
COPY --from=build /app/workers/email-worker/package.json ./workers/email-worker/
COPY --from=build /app/workers/analytics-worker/dist ./workers/analytics-worker/dist
COPY --from=build /app/workers/analytics-worker/package.json ./workers/analytics-worker/
COPY --from=build /app/workers/campaign-enrollment-worker/dist ./workers/campaign-enrollment-worker/dist
COPY --from=build /app/workers/campaign-enrollment-worker/package.json ./workers/campaign-enrollment-worker/
COPY --from=build /app/workers/deliverability-worker/dist ./workers/deliverability-worker/dist
COPY --from=build /app/workers/deliverability-worker/package.json ./workers/deliverability-worker/
COPY --from=build /app/workers/enrichment-worker/dist ./workers/enrichment-worker/dist
COPY --from=build /app/workers/enrichment-worker/package.json ./workers/enrichment-worker/
COPY --from=build /app/workers/inbound-worker/dist ./workers/inbound-worker/dist
COPY --from=build /app/workers/inbound-worker/package.json ./workers/inbound-worker/
COPY --from=build /app/workers/inbox-reply-worker/dist ./workers/inbox-reply-worker/dist
COPY --from=build /app/workers/inbox-reply-worker/package.json ./workers/inbox-reply-worker/
COPY --from=build /app/workers/lead-discovery-worker/dist ./workers/lead-discovery-worker/dist
COPY --from=build /app/workers/lead-discovery-worker/package.json ./workers/lead-discovery-worker/
COPY --from=build /app/workers/lead-research-worker/dist ./workers/lead-research-worker/dist
COPY --from=build /app/workers/lead-research-worker/package.json ./workers/lead-research-worker/
COPY --from=build /app/workers/import-worker/dist ./workers/import-worker/dist
COPY --from=build /app/workers/import-worker/package.json ./workers/import-worker/
COPY --from=build /app/workers/scheduler-worker/dist ./workers/scheduler-worker/dist
COPY --from=build /app/workers/scheduler-worker/package.json ./workers/scheduler-worker/
COPY --from=build /app/workers/verification-worker/dist ./workers/verification-worker/dist
COPY --from=build /app/workers/verification-worker/package.json ./workers/verification-worker/
COPY --from=build /app/workers/warmup-worker/dist ./workers/warmup-worker/dist
COPY --from=build /app/workers/warmup-worker/package.json ./workers/warmup-worker/
COPY --from=build /app/workers/website-worker/dist ./workers/website-worker/dist
COPY --from=build /app/workers/website-worker/package.json ./workers/website-worker/
COPY --from=build /app/workers/workflow-worker/dist ./workers/workflow-worker/dist
COPY --from=build /app/workers/workflow-worker/package.json ./workers/workflow-worker/

# Prisma config for migrations
COPY --from=build /app/packages/database/prisma.config.ts ./packages/database/

# Recreate pnpm dependency symlinks so Node.js ESM resolver finds all packages.
RUN set -e; \
    for pkg in node_modules/.pnpm/node_modules/*; do \
      name=$(basename "$pkg"); \
      [ -e "node_modules/$name" ] || ln -s ".pnpm/node_modules/$name" "node_modules/$name"; \
    done; \
    for scope in node_modules/.pnpm/node_modules/@*; do \
      sname=$(basename "$scope"); \
      mkdir -p "node_modules/$sname"; \
      for pkg in "$scope"/*; do \
        pname=$(basename "$pkg"); \
        [ -e "node_modules/$sname/$pname" ] || ln -s "../.pnpm/node_modules/$sname/$pname" "node_modules/$sname/$pname"; \
      done; \
    done; \
    mkdir -p node_modules/@signalforge; \
    ln -sf ../../packages/ai node_modules/@signalforge/ai; \
    ln -sf ../../packages/allocation node_modules/@signalforge/allocation; \
    ln -sf ../../packages/analytics node_modules/@signalforge/analytics; \
    ln -sf ../../packages/auth node_modules/@signalforge/auth; \
    ln -sf ../../packages/automations node_modules/@signalforge/automations; \
    ln -sf ../../packages/campaigns node_modules/@signalforge/campaigns; \
    ln -sf ../../packages/config node_modules/@signalforge/config; \
    ln -sf ../../packages/database node_modules/@signalforge/database; \
    ln -sf ../../packages/deliverability node_modules/@signalforge/deliverability; \
    ln -sf ../../packages/email node_modules/@signalforge/email; \
    ln -sf ../../packages/inbound node_modules/@signalforge/inbound; \
    ln -sf ../../packages/inbox node_modules/@signalforge/inbox; \
    ln -sf ../../packages/integrations node_modules/@signalforge/integrations; \
    ln -sf ../../packages/lead-discovery node_modules/@signalforge/lead-discovery; \
    ln -sf ../../packages/lead-research node_modules/@signalforge/lead-research; \
    ln -sf ../../packages/mailboxes node_modules/@signalforge/mailboxes; \
    ln -sf ../../packages/queue node_modules/@signalforge/queue; \
    ln -sf ../../packages/sending node_modules/@signalforge/sending; \
    ln -sf ../../packages/shared node_modules/@signalforge/shared; \
    ln -sf ../../packages/validation node_modules/@signalforge/validation; \
    ln -sf ../../packages/verification node_modules/@signalforge/verification; \
    ln -sf ../../packages/warmup node_modules/@signalforge/warmup; \
    ln -sf ../../packages/website-scanner node_modules/@signalforge/website-scanner

USER node

# Default: email-worker. Override per service in docker-compose.
CMD ["node", "workers/email-worker/dist/index.js"]
