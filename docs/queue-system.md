# Queue System

## Stack

- Redis 7
- BullMQ
- Shared helpers in `@signalforge/queue`

## Queue names

| Queue | Purpose |
|-------|---------|
| `email-send` | Outbound campaign email |
| `email-retry` | Retry transient send failures |
| `email-inbound` | Inbound IMAP processing |
| `warmup` | Warmup scheduling |
| `lead-processing` | Import/normalize/dedupe |
| `lead-enrichment` | Enrichment jobs |
| `ai` | AI scoring/research/personalization |
| `analytics` | Metric aggregation |
| `notifications` | User/system notifications |
| `health` | Worker heartbeat (M0) |
| `lead-research` | LinkedIn lead research (Module 17); concurrency from `LINKEDIN_RESEARCH_MAX_CONCURRENCY`, 2 attempts, retries only timeouts / unavailable providers |

Later modules added `website-analysis`, `lead-discovery`, `email-verification`, `workflow`, `scheduler-tick` and deliverability queues; see `QUEUE_NAMES` in `packages/queue/src/index.ts` for the authoritative list.

## Worker requirements

- Validate jobs
- Bounded retries with backoff
- Structured logging with job/workspace/campaign context
- Idempotency where appropriate

## M0 status

`workers/email-worker` connects to Redis and processes `health` queue jobs only.
