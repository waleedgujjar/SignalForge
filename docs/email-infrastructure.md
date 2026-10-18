# Email Infrastructure

SignalForge does **not** operate its own mailbox provider. External mailboxes are connected via:

- SMTP / IMAP
- Google OAuth (future)
- Microsoft OAuth (future)

## Responsibilities

SignalForge manages:

- Mailbox connections and encrypted credentials
- Sending and receiving orchestration
- Scheduling and rate limits
- Mailbox health and warmup configuration
- Reply synchronization
- Deliverability controls

## Sending pipeline (planned)

```
Campaign → Scheduler → Send Job → Redis → Sending Policy Engine
  → Suppression → Mailbox Health → Rate Limits → BullMQ
  → Email Worker → External Mailbox Provider
```

## M0 status

`@signalforge/email` is a stub package. No SMTP/IMAP sending is implemented in M0.

## Security

Mailbox credentials and OAuth tokens must be encrypted at rest. Never expose secrets to the frontend or logs.

See [Security](security.md).
