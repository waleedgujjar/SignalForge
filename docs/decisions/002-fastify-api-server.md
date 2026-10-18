# ADR-002: Fastify for API Server

## Status

Accepted

## Context

The API must be modular, type-safe, and production-ready.

## Decision

Use Fastify with plugins for CORS, Helmet, and route modules.

## Consequences

- Strong plugin ecosystem
- Built-in schema validation support for future routes
- Different from PRD note suggesting Next.js API routes; engineering spec takes precedence for M0
