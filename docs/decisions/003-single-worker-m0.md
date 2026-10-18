# ADR-003: Single Worker in M0

## Status

Accepted

## Context

The platform will eventually have multiple workers (email, warmup, lead, AI).

## Decision

Implement only `workers/email-worker` in M0 with a health/heartbeat queue processor.

## Consequences

- Faster foundation delivery
- Additional workers added per milestone without restructuring the monorepo
