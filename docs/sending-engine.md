# Sending Engine

## SendingPolicyEngine (planned)

Before every outbound email, the policy engine evaluates:

- Campaign and lead active status
- Suppression and unsubscribe state
- Previous bounces
- Mailbox and domain health
- Warmup restrictions
- Daily mailbox, campaign, and provider limits
- Sending windows and rate limits
- Workspace policy and compliance rules

Outcome:

- `ALLOW_SEND` — proceed to queue/worker
- `BLOCK_SEND` — store reason (e.g. `SEND_BLOCKED_MAILBOX_DAILY_LIMIT`)

## Reusability

The policy engine must be shared by campaign sends, warmup sends, and future workflows.

## M0 status

Policy engine interfaces and documentation only. Implementation begins in M5.
