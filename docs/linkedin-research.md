# LinkedIn Lead Research & Enrichment (Module 17)

**Status:** Implemented behind `LINKEDIN_RESEARCH_ENABLED` (default `false`)
**Scope:** Source-agnostic `LeadResearch` records, LinkedIn as the first source, manual researcher verification, provider health, AI qualification + scoring evidence, research history

## 1. What the feature does

SignalForge can attach **attributed research** to an existing lead. A researcher pastes a LinkedIn **company URL** and/or **person URL** on the lead page; SignalForge validates and classifies the URL, creates a `LeadResearch` record, runs the configured *approved* research path (or asks for manual verification), stores structured data **with field-level provenance**, and feeds the result into the existing enrichment worker so the AI Provider Layer, lead scoring and qualification can use it. Qualified leads flow into campaigns exactly as before.

```text
Lead → LeadResearch (LinkedIn) → verified / attributed data → enrichment worker
     → AI qualification (VERIFIED / INFERRED / UNKNOWN) → lead score → campaign
```

LinkedIn is an **enrichment source**. Lead discovery (Google Places, CSV/XLSX, other approved sources), website intelligence, email verification, scoring and campaigns are unchanged systems that now receive more evidence.

## 2. What it does NOT do

The module deliberately does not implement, and its architecture prevents:

- automated LinkedIn scraping at scale, crawling, or search
- automated connection requests, messages, likes, comments or follows
- CAPTCHA bypass, anti-bot bypass or rate-limit bypass
- proxy rotation or any mechanism intended to evade LinkedIn restrictions
- fake accounts or credential harvesting
- storing LinkedIn passwords, cookies, session tokens or browser profiles

LinkedIn's User Agreement restricts unauthorized automated access. SignalForge therefore only reads **URLs a researcher provides**, performs **at most one request per researcher action**, and **stops** on any refusal (authwall, 401/403, 429/999, CAPTCHA, private profile) by routing the record to **Manual Review** with the reason. Nothing is ever retried around a refusal.

## 3. Supported research methods

| Provider | What it does | Configured when | Max confidence |
|---|---|---|---|
| `manual` | Immediately marks the record **Manual Review**; the researcher opens LinkedIn themselves and enters what they confirmed | always (terminal fallback) | HIGH (all fields `VERIFIED`) |
| `public` | **One** fetch of the pasted public URL through Jina Reader (`https://r.jina.ai/<url>`), deterministic parsing of fields that are visibly present (name, headline/title, industry, location, "N employees") | `LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED=true` | MEDIUM (fields `INFERRED`) |
| `agent-reach` | Uses [Agent-Reach](https://github.com/Panniantong/Agent-Reach) for **provider health** (`agent-reach doctor --json`) and its documented public-page path (Jina Reader). The authenticated `linkedin-mcp-server` path is a gated, **unimplemented** extension point | `agent-reach` on `PATH` (or `AGENT_REACH_BIN`) | MEDIUM |
| `authorized-api` | Placeholder descriptor only — requires a LinkedIn partner API agreement | never (v1) | — |

The provider **chain always ends in `manual`**, so a research job can never fail silently: it ends `COMPLETED`, `PARTIAL`, `MANUAL_REVIEW` (with reason), `UNAVAILABLE` or `FAILED`.

Selection: `LINKEDIN_RESEARCH_PROVIDER=public` (default) → `[public, manual]`; `agent-reach` → `[agent-reach, public, manual]`; `manual` → `[manual]`. A provider only joins the chain when it is configured **and** enabled for the workspace (Settings → Research Providers; `manual` and `public` are enabled by default, `agent-reach` is not).

### Agent-Reach and the MCP extension point

Agent-Reach's LinkedIn backend is the third-party `linkedin-mcp-server`, which drives a researcher's **logged-in LinkedIn browser session** and also exposes connection, messaging and inbox tools. SignalForge does **not** call it. If the gated path (`LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED`, default `false`) is ever implemented, it must bind **read tools only** (`get_person_profile`, `get_company_profile`), one URL per researcher action, honour every refusal with Manual Review, and keep all authentication in Agent-Reach's own store (`~/.agent-reach/`, `~/.linkedin-mcp/`) — never in SignalForge.

## 4. Agent-Reach setup (optional)

Agent-Reach is a Python 3.10+ CLI. Install it in a virtual environment on the API/worker host (no `--system`, no LinkedIn login required for health checks):

```bash
uv venv ~/.agent-reach-venv
uv pip install --python ~/.agent-reach-venv/bin/python https://github.com/Panniantong/agent-reach/archive/main.zip
~/.agent-reach-venv/bin/agent-reach doctor --json
```

On Windows the executable is `%USERPROFILE%\.agent-reach-venv\Scripts\agent-reach.exe`. Point `AGENT_REACH_BIN` at that path when it is not on `PATH`, set `LINKEDIN_RESEARCH_PROVIDER=agent-reach`, and enable the provider for the workspace in Settings → Research Providers.

## 5. Provider health checks

`GET /lead-research/providers/status` never throws. `POST /lead-research/providers/health-check` (ADMIN) runs live checks and persists `lastHealthCheckAt` / `lastHealthStatus` per workspace.

| Status | Meaning |
|---|---|
| `READY` | Provider can run now |
| `NEEDS_SETUP` | Installed/known but not configured (e.g. Agent-Reach binary missing, LinkedIn channel not configured) |
| `UNAVAILABLE` | Health check failed (timeout, error, unparseable output) or provider not implemented |
| `DISABLED` | Turned off by env or the module flag |

`authentication` is `CONFIGURED` / `NOT_CONFIGURED` / `NOT_REQUIRED` — a label only. Credentials are never returned. Agent-Reach `doctor` output is sanitized (token-, cookie- and key-like values are redacted) before it is persisted or displayed.

Agent-Reach mapping: `web.status === 'ok'` → `READY` (the public path this release uses); `linkedin.status` `ok`/`warn` → `authentication: CONFIGURED`, `off`/`error` → `NOT_CONFIGURED`; binary not found → `NEEDS_SETUP`; timeout / non-zero exit / bad JSON → `UNAVAILABLE`.

## 6. Manual verification workflow

1. Open a lead → **Research → LinkedIn**. Paste the company and/or person URL and click **Research LinkedIn**.
2. The record is queued and processed by `lead-research-worker`. If the provider is refused or only `manual` is available, the record becomes **Manual Review** with the reason (e.g. "LinkedIn served a sign-in wall").
3. Click **Open LinkedIn** (opens the URL in a new tab) and confirm the facts yourself, then **Enter Data**: person name/title/profile URL, company name/URL/industry/location/employee range, signals (decision maker, hiring, growth, technology), notes.
4. Saving marks the record **Completed · manual · High**, every supplied field gets provenance `source: MANUAL, verification: VERIFIED`, empty lead fields (job title, LinkedIn URL, first/last name) are filled — never overwritten — and enrichment re-runs automatically.
5. A provider-fetched result can be promoted with **Mark as Manually Verified** after you checked it.

The **Research Queue** page (`/leads/research`) lists everything that needs a human: suggested items from imports awaiting approval, manual reviews, failures.

## 7. Data model

| Model | Purpose |
|---|---|
| `LeadResearch` | One research attempt against one source for one lead. Append-only history; "latest per (source, researchType)" is computed at read time. `PENDING` rows are suggestions awaiting approval. |
| `LeadResearchActivity` | Audit trail (operation, status, provider, error code, actor, timestamps). |
| `ResearchProviderConfig` | Per-workspace enablement, usage counters, last health result. **No credentials.** |
| `LeadEnrichment.opportunityAssessment` | AI assessment (ICP fit, service fit, AI receptionist / customer response / appointment booking / website opportunity, lead quality), each `{ value, status: VERIFIED|INFERRED|UNKNOWN, evidence[] }`. |

Enums: `LeadResearchSource` (`LINKEDIN WEBSITE FACEBOOK YOUTUBE REDDIT WEB OTHER`), `LeadResearchType` (`COMPANY PERSON JOB OTHER`), `LeadResearchStatus` (`PENDING QUEUED IN_PROGRESS COMPLETED PARTIAL MANUAL_REVIEW FAILED UNAVAILABLE`), `ResearchConfidence` (`HIGH MEDIUM LOW UNKNOWN`). `WorkflowEventType` gained `LEAD_RESEARCH_COMPLETED`.

`structuredData` (only fields actually available are set — nothing is fabricated):

```json
{
  "company": { "name": "", "url": "", "industry": "", "location": "", "employeeRange": "" },
  "person": { "firstName": "", "lastName": "", "fullName": "", "title": "", "profileUrl": "" },
  "signals": { "decisionMaker": false, "hiring": false, "growthSignal": false, "technologySignal": false },
  "source": { "platform": "linkedin", "url": "", "retrievedAt": "" }
}
```

`provenance[]` entries: `{ field, value, source, sourceUrl, provider, retrievedAt, confidence (0..1), verification: VERIFIED|INFERRED|UNKNOWN }`. Never present an inferred value as verified: the UI shows the label next to every field.

## 8. API endpoints (`/lead-research`, workspace-guarded)

| Method / path | Purpose |
|---|---|
| `GET /providers/status` | Module + provider status (never throws; `{ status: 'disabled' }` when off) |
| `POST /providers/health-check` (ADMIN) | Run live health checks and persist them |
| `GET /providers`, `PUT /providers` (ADMIN) | Per-workspace provider enablement (`manual` cannot be disabled) |
| `POST /research` | Create research for `{ leadId, companyUrl?, personUrl? }` → `202` |
| `POST /research/batch` | Approve `PENDING` suggestions by `researchIds` / `leadIds` (capped by `LINKEDIN_RESEARCH_MAX_BATCH_SIZE`) |
| `GET /queue` | Items needing attention (`MANUAL_REVIEW`, `PENDING`, `FAILED`, `UNAVAILABLE`), paginated |
| `GET /stats` | Counts by status/type, manual-review and pending counts, provider usage |
| `GET /suggestions/:leadId` | Research suggestions with reasons |
| `GET /lead/:leadId` | Latest record per source + type |
| `GET /lead/:leadId/history` | Unified history: LinkedIn research + website analyses + email verification |
| `GET /research/:id` | Full record incl. provenance and sanitized raw data |
| `POST /research/:id/verify` | Save manual verification |
| `POST /research/:id/mark-verified` | Mark a fetched result as manually verified |
| `POST /research/:id/retry` | Re-queue a `FAILED` / `UNAVAILABLE` / `MANUAL_REVIEW` record |

When the module flag is off, read endpoints return empty/`disabled` payloads and mutations return `501 { error: 'LinkedIn research is disabled' }`. Invalid or unsupported URLs return `422 { error, code }`; validation errors `400`; wrong state `409`; cross-workspace access `404`.

Bulk import: `POST /leads/import` (and Drive import) accept mapped columns `linkedin_company_url` / `linkedin_person_url` (aliases auto-detected). The person URL fills `Lead.linkedinUrl`; both create `PENDING` `LeadResearch` suggestions that a user **approves** in the Research Queue — nothing is researched automatically on import.

## 9. UI workflow

- **Lead page → Research card**: tabs *LinkedIn* (inputs, status rows, provenance, manual verification), *Website* (read-only view of the existing website analysis), *Web* / *Facebook* (not available yet, disabled). **Research History** card below it. **Lead Intelligence** card gains an *Opportunity Assessment* section that renders "Unknown" whenever a fact was not established.
- **Leads → Research Queue** (`/leads/research`): stats, filters, bulk approve, Open LinkedIn / Enter Data / Retry / Open lead actions.
- **Settings → Research Providers** (`/settings/research`): per-provider status, authentication label, last health check, usage, ADMIN toggle, **Run Health Check**, setup instructions, compliance notice.

## 10. Troubleshooting

| Error code | Status | Reason shown | What to do |
|---|---|---|---|
| `INVALID_URL` | 422 / FAILED | Not a valid URL | Paste the full `https://www.linkedin.com/...` URL |
| `UNSUPPORTED_URL` | 422 / FAILED | Not a linkedin.com profile/company/job URL (short links, feed, search…) | Use `/in/`, `/company/`, `/school/` or `/jobs/view/` URLs |
| `LOGIN_REQUIRED` | MANUAL_REVIEW | LinkedIn served a sign-in wall (authwall, 401/403) | Open LinkedIn yourself and enter the data |
| `PRIVATE_PROFILE` | MANUAL_REVIEW | Profile not publicly visible | Manual verification |
| `RATE_LIMITED` | MANUAL_REVIEW | 429 / 999 from LinkedIn or the reader | Stop; do not retry; verify manually |
| `PAGE_UNAVAILABLE` | UNAVAILABLE | 404 / 410 | Check the URL; the page may have moved |
| `PARSE_FAILED` | MANUAL_REVIEW | Page fetched but no structured field could be read | Manual verification |
| `PROVIDER_UNAVAILABLE` | FAILED (retryable) | Reader/service unreachable or 5xx | Check network / `JINA_READER_BASE_URL`; retry later |
| `PROVIDER_NOT_CONFIGURED` | (chain falls through) | Provider not installed/enabled | Settings → Research Providers |
| `TIMEOUT` | FAILED (retryable) | Exceeded `LINKEDIN_RESEARCH_TIMEOUT_MS` | Retry; raise the timeout if the host is slow |
| `INCOMPLETE` | PARTIAL | Some fields could not be retrieved | Complete via Enter Data |
| `FEATURE_DISABLED` | UNAVAILABLE | Job ran after the flag was turned off | Enable `LINKEDIN_RESEARCH_ENABLED` and retry |
| Agent-Reach `NEEDS_SETUP` | — | `agent-reach` binary not found | Install (section 4) and set `AGENT_REACH_BIN` |
| `.cmd` shim on Windows | — | Node refuses to spawn `.cmd` without a shell | Point `AGENT_REACH_BIN` at the `.exe` in the venv `Scripts` folder |

## 11. Security considerations

- **No credentials in SignalForge.** No LinkedIn password, cookie, token or browser profile is ever stored, logged or returned. `ResearchProviderConfig` has no secret columns; `JINA_API_KEY` and `AGENT_REACH_BIN` stay server-side.
- **Tenant isolation.** Every route is workspace-guarded and every query is scoped by `workspaceId`; other workspaces' records are `404`. Provider toggles and health checks require `ADMIN`.
- **Server-side validation.** URLs are validated (https, `*.linkedin.com`, supported path class, ≤500 chars) before anything is stored or fetched; manual fields are length-capped.
- **Single outbound host.** The public provider talks only to `JINA_READER_BASE_URL` (https) with the normalized URL as the path — no arbitrary hosts, no proxies, no header spoofing (`User-Agent: SignalForge-LeadResearch/1.0`).
- **Sanitized output.** Provider output and Agent-Reach `doctor` lines pass a redaction filter before persistence or display; API responses strip secret-looking keys.
- **Structured, allow-listed logs.** Worker/API logs carry ids, source, provider, operation, status, timestamps and error codes only — never URLs with query strings, raw provider output or secrets.
- **Research-job controls.** Concurrency (`LINKEDIN_RESEARCH_MAX_CONCURRENCY`, default 1), attempts (`LINKEDIN_RESEARCH_MAX_ATTEMPTS`, default 2, retrying only timeouts/unavailable providers), batch cap, per-workspace usage counters.
- **Prompt safety.** Researched text enters the AI prompt as untrusted data; the model must answer `UNKNOWN` for facts not established by research.

**LinkedIn automation and scraping restrictions must be respected.** Keep the provider architecture replaceable and use only permitted access paths.

## Environment

```env
LINKEDIN_RESEARCH_ENABLED=false
# LINKEDIN_RESEARCH_PROVIDER=public             # manual | public | agent-reach
# LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED=true
# LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED=false
# LINKEDIN_RESEARCH_MAX_CONCURRENCY=1
# LINKEDIN_RESEARCH_TIMEOUT_MS=20000
# LINKEDIN_RESEARCH_MAX_ATTEMPTS=2
# LINKEDIN_RESEARCH_MAX_BATCH_SIZE=50
# AGENT_REACH_BIN=agent-reach
# AGENT_REACH_HEALTH_TIMEOUT_MS=15000
# JINA_READER_BASE_URL=https://r.jina.ai
# JINA_API_KEY=
```

Note: these new flags are parsed strictly (`true`/`1` = on), unlike older `*_ENABLED` flags which treat any non-empty string as on.
