# Module 15 — Automation & Workflow Engine

## Overview

Module 15 adds a workspace-scoped workflow engine that orchestrates existing SignalForge services. The engine never sends SMTP directly, verifies MX itself, or classifies replies — every action delegates to existing modules.

## Architecture

- **Event bus:** `publishWorkflowEvent` writes `WorkflowEvent` rows and enqueues `QUEUE_NAMES.WORKFLOW`
- **Worker:** `workers/workflow-worker` processes event matching and step advancement
- **Scheduler:** `AutomationSchedulerService` resumes `WAITING` executions via scheduler tick
- **Package:** `@signalforge/automations`

## Data model

| Model | Purpose |
|-------|---------|
| `Workflow` | Workspace workflow with status (`DRAFT`/`ACTIVE`/`PAUSED`/`ARCHIVED`) |
| `WorkflowVersion` | Immutable graph JSON (`nodes`, `edges`) |
| `WorkflowExecution` | Pinned run for `(workflowVersionId, leadId)` |
| `WorkflowNodeExecution` | Per-node attempt with idempotency via unique `(executionId, nodeId)` |
| `WorkflowEvent` | Inbound bus row with unique `(workspaceId, idempotencyKey)` |
| `WorkflowActivity` | Audit trail |
| `Notification` | In-app notifications (header bell) |

## Node types

**Triggers:** `LEAD_CREATED`, `LEAD_IMPORTED`, `LEAD_VERIFIED`, `LEAD_QUALIFIED`, `CAMPAIGN_STARTED`, `EMAIL_SENT`, `EMAIL_BOUNCED`, reply events, `MEETING_BOOKED`, `WEBSITE_ANALYSIS_COMPLETED`, `LEAD_RESEARCH_COMPLETED` (Module 17)

**Actions:** Verify, Qualify, Campaign enroll/remove, Send Email (campaign-backed), Tags/Lists, Update Lead (allowlisted fields), Notify User, Pause Lead, Stop Workflow

**Logic:** Condition (single AND or OR group)

**Timing:** Delay (minutes/hours/days)

## API

Prefix: `/automations`

- CRUD workflows, publish/pause/resume/archive/duplicate
- Executions, logs, templates
- Notifications list + mark read

RBAC: `ADMIN` required for publish/pause/resume/archive; `VIEWER` read-only.

## Frontend

- `/automations` — list + templates
- `/automations/[id]` — React Flow builder with node library, config panel, save/publish
- `/automations/[id]/logs` — execution log table
- `/automations/[id]/executions/[executionId]` — node timeline
- Header notification bell

## Pause policy

- `ACTIVE → PAUSED`: new events do not start executions
- `RUNNING` finishes current node then pauses if more nodes remain
- `WAITING` delays stay waiting until workflow is `ACTIVE` again
- Archive cancels non-terminal executions

## Known v1 limitations

- Send Email is campaign-backed only (no one-off SMTP)
- Notifications are in-app only
- `QUALIFY_LEAD` does not wait on enrichment completion
- Condition groups are single AND or OR, not nested
- No Slack/webhooks/workflow import-export
