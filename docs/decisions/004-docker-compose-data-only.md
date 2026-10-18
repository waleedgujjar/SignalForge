# ADR-004: Docker Compose for Data Services Only

## Status

Accepted

## Context

Developers need PostgreSQL and Redis locally with a fast application dev loop.

## Decision

Docker Compose runs PostgreSQL, Redis, and optional Mailpit. Apps run on the host via `pnpm dev`.

## Consequences

- Fast hot reload for Next.js and API
- Consistent data services across machines
- Production containerization deferred to deployment milestone
