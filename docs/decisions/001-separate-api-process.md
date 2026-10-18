# ADR-001: Separate API Process

## Status

Accepted

## Context

SignalForge needs a scalable backend that supports HTTP APIs and background workers without coupling to the Next.js runtime.

## Decision

Run a dedicated Fastify API in `apps/api`. The Next.js app in `apps/web` is UI-only.

## Consequences

- Clear separation of concerns
- Workers can import shared packages without Next.js
- Requires CORS and separate deployment units
