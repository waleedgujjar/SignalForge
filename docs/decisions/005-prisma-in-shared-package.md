# ADR-005: Prisma in Shared Package

## Status

Accepted

## Context

API and workers both need typed database access with a single schema.

## Decision

Place Prisma schema and client in `packages/database`.

## Consequences

- One migration source of truth
- Turbo `db:generate` runs before builds
- M0 uses minimal schema; product models added incrementally
