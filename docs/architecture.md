# SignalForge Architecture

SignalForge is an AI outbound sales and intelligence platform built as a production-grade monorepo.

## Repository layout

```
apps/web          Next.js frontend
apps/api          Fastify HTTP API
workers/*         Background job processors
packages/*        Shared domain and infrastructure libraries
infrastructure/   Docker, nginx, deployment placeholders
docs/             Architecture and decision records
```

## Domain packages (selected)

- `@signalforge/lead-discovery` — acquisition (CSV/XLSX, approved sources), dedup, promotion
- `@signalforge/website-scanner` — website intelligence
- `@signalforge/verification` — email verification engine
- `@signalforge/lead-research` — source-agnostic lead research (LinkedIn first) with manual verification; see [linkedin-research.md](linkedin-research.md)
- `@signalforge/ai` — AI Provider Layer, deterministic scorers
- `@signalforge/automations` — workflows

Workers: one process per domain queue under `workers/*` (e.g. `enrichment-worker`, `website-worker`, `verification-worker`, `lead-discovery-worker`, `lead-research-worker`).

## Process boundaries

- **Web (`apps/web`)** — UI only. No direct database access. No email sending.
- **API (`apps/api`)** — HTTP endpoints, authorization (future), business orchestration.
- **Workers (`workers/*`)** — Async jobs via BullMQ (email, warmup, leads, AI).
- **Packages** — Reusable modules imported by API and workers.

## Multi-tenant model (planned)

```
Platform
  └── Workspace
        ├── Users
        ├── Leads / Companies / Contacts
        ├── Campaigns
        └── Mailboxes
```

Workspace isolation will be enforced server-side in M1+.

## Milestone roadmap

| Milestone | Scope |
|-----------|-------|
| M0 | Production foundation (current) |
| M1 | Authentication & workspace |
| M2 | Lead management |
| M3 | External mailboxes |
| M4 | Campaign builder |
| M5 | Sending engine |
| M6 | Inbox & reply management |
| M7 | Warmup |
| M8 | Deliverability |
| M9 | AI |
| M10 | Analytics |
| M11 | Lead discovery |
| M12 | Advanced automation |

## Product reference

See [docs/product/AI_Outbound_Sales_OS_PRD_v1.1.pdf](product/AI_Outbound_Sales_OS_PRD_v1.1.pdf).

## Related docs

- [Database](database.md)
- [Email infrastructure](email-infrastructure.md)
- [Sending engine](sending-engine.md)
- [Security](security.md)
- [AI](ai.md)
- [Queue system](queue-system.md)
- [LinkedIn lead research](linkedin-research.md)
- [Module docs](modules/)
- [Architecture decisions](decisions/)
