# Security

## Secrets

- Never commit `.env` or real credentials
- Encrypt SMTP/IMAP credentials and OAuth tokens at rest (M3+)
- `ENCRYPTION_KEY` and `SESSION_SECRET` are required environment variables

## Authorization

- Server-side authorization on every protected operation
- Workspace isolation enforced in API and workers (M1+)
- Never rely on frontend filtering alone

## Input validation

- Zod schemas for API input and shared validation
- Reject malformed requests at the boundary

## Transport and headers

- CORS restricted to `APP_URL`
- Helmet security headers on API
- HTTPS in production (nginx, planned)

## Audit

Sensitive actions will be recorded in `AuditLog` (M1+).

## Logging

Never log credentials, tokens, or message bodies containing secrets.
