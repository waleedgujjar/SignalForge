# ADR-006: AI Provider Abstraction

## Status

Accepted

## Context

OpenAI API key is not available during initial development.

## Decision

Implement `AIProvider` with `MockAIProvider` as default (`AI_PROVIDER=mock`). OpenAI provider added later without changing business logic.

## Consequences

- Local development works without external AI dependencies
- All AI consumers must use the interface, not vendor SDKs directly
