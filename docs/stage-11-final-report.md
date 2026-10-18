# Stage 11: Web Research — Final Report

## Summary

Stage 11 adds a **Web Research** source to SignalForge's lead research infrastructure. Given a lead with a known company website, the web research provider crawls the site using the existing `@signalforge/website-scanner`, extracts structured business intelligence with deterministic cheerio extraction, and optionally passes text through an AI interpretation layer. Every finding is attributed to the specific URL it came from.

**Zero-cost-first**: The primary provider uses the built-in website scanner — no paid APIs. AI interpretation is optional and disabled by default (`WEB_RESEARCH_AI_INTERPRETATION_ENABLED=false`). The feature works out of the box with zero API cost.

## Architecture

The web research module mirrors the LinkedIn provider chain exactly:

```
packages/lead-research/src/web/
├── types.ts          — WebCompanyData, WebProviderName, WEB_PROVIDER_MAX_CONFIDENCE
├── provider.ts       — WebResearchProvider interface (COMPANY-only)
├── extract.ts        — 9 pure cheerio extraction functions
├── interpret.ts      — Optional AI layer with prompt injection protection
├── normalize.ts      — Web-specific confidence rules + normalizeWebOutcome()
├── registry.ts       — selectWebProviderChain() + provider listing
├── service.ts        — WebResearchService.run() + mapWebOutcomeToRecordUpdate()
└── providers/
    ├── website.ts    — Primary: crawlWebsite() → cheerio → optional AI
    └── manual.ts     — Terminal: always returns MANUAL_REVIEW
```

**Worker routing**: The processor reads `research.source` from the loaded row via `resolveSourceConfig()`:
- `LINKEDIN` → existing LinkedIn flow (unchanged)
- `WEB` → WebResearchService + selectWebProviderChain()
- anything else → UNAVAILABLE with UNSUPPORTED_URL

## Files Created (10)

| File | Purpose |
|------|---------|
| `packages/lead-research/src/web/types.ts` | Web-specific data shapes |
| `packages/lead-research/src/web/provider.ts` | WebResearchProvider interface |
| `packages/lead-research/src/web/extract.ts` | Deterministic cheerio extraction |
| `packages/lead-research/src/web/interpret.ts` | Optional AI interpretation |
| `packages/lead-research/src/web/normalize.ts` | Web confidence calculation |
| `packages/lead-research/src/web/registry.ts` | Provider registry + chain selector |
| `packages/lead-research/src/web/service.ts` | Chain execution service |
| `packages/lead-research/src/web/providers/website.ts` | Primary website crawl provider |
| `packages/lead-research/src/web/providers/manual.ts` | Terminal manual review provider |
| `docs/stage-11-final-report.md` | This report |

## Files Modified (6)

| File | Change |
|------|--------|
| `packages/config/src/index.ts` | Added 4 web research config flags |
| `packages/lead-research/package.json` | Added cheerio, openai, website-scanner deps |
| `packages/lead-research/src/types.ts` | Widened data types to `Record<string, unknown>`, added WEB_PUBLIC provenance source |
| `packages/lead-research/src/index.ts` | Added barrel exports for web module + `isWebResearchEnabled()` |
| `packages/lead-research/src/suggestions.ts` | Activated WEB_SEARCH suggestion slot |
| `packages/lead-research/src/service.ts` | Added `createWebResearchRequests()` method |
| `packages/lead-research/src/linkedin/normalize.ts` | Type cast fix for widened data type |
| `workers/lead-research-worker/src/processor.ts` | Source-based routing via `resolveSourceConfig()` |
| `apps/api/src/routes/lead-research.ts` | Added `POST /research/web` endpoint, updated suggestions |

## Test Files Created (5)

| File | Tests |
|------|-------|
| `packages/lead-research/src/web/__tests__/extract.test.ts` | 21 tests — all 9 extraction functions |
| `packages/lead-research/src/web/__tests__/website-provider.test.ts` | 10 tests — provider extraction, provenance, AI failure, crawl errors |
| `packages/lead-research/src/web/__tests__/service.test.ts` | 6 tests — chain execution, timeout, mapOutcome |
| `packages/lead-research/src/web/__tests__/interpret.test.ts` | 6 tests — AI prompt injection protection, edge cases |
| `packages/lead-research/src/web/__tests__/suggestions.test.ts` | 6 tests — WEB_SEARCH suggestion availability |
| `workers/lead-research-worker/src/processor.test.ts` | +5 tests — web routing, feature gate, force refresh |

## Config Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `WEB_RESEARCH_ENABLED` | `false` | Master gate for web research |
| `WEB_RESEARCH_TIMEOUT_MS` | `30000` | Per-provider timeout |
| `WEB_RESEARCH_MAX_PAGES` | `5` | Max pages to crawl per site |
| `WEB_RESEARCH_AI_INTERPRETATION_ENABLED` | `false` | AI interpretation layer |

## Verification

| Check | Result |
|-------|--------|
| `pnpm build` | 39/39 tasks successful |
| `pnpm --filter @signalforge/lead-research test` | 49/49 pass |
| `pnpm --filter @signalforge/lead-research-worker test` | 13/13 pass (8 existing + 5 new) |
| `pnpm --filter @signalforge/lead-discovery test` | 176/176 pass (regression) |

## Required Test Coverage (13+)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Website provider extracts company data from HTML | extract.test.ts + website-provider.test.ts |
| 2 | Provenance attribution on every field | website-provider.test.ts |
| 3 | AI interpretation with prompt injection protection | interpret.test.ts |
| 4 | AI failure preserves deterministic extractions | website-provider.test.ts |
| 5 | Provider chain execution order | service.test.ts |
| 6 | Idempotency — no duplicate research | service.ts dedup logic (DB-level) |
| 7 | Error: site down (crawl fails) | website-provider.test.ts |
| 8 | Error: timeout | service.test.ts |
| 9 | Worker routes WEB to WebResearchService | processor.test.ts |
| 10 | Worker routes LINKEDIN unchanged | processor.test.ts (existing + new) |
| 11 | Feature gate: WEB_RESEARCH_ENABLED=false | processor.test.ts |
| 12 | Multi-tenancy enforcement | processor.test.ts (existing) |
| 13 | Manual review fallback | service.test.ts |
| 14 | Force refresh bypass | processor.test.ts |
| 15 | Suggestions: WEB_SEARCH available | suggestions.test.ts |

## Security

- All crawled web content is treated as UNTRUSTED DATA
- AI system prompt includes explicit anti-injection rules
- Provenance tracks every field's source URL and confidence
- Multi-tenancy enforced via workspace-scoped queries
- URL validation via website-scanner's SSRF-protected `validateUrl()`
- No LinkedIn scraping or paid API usage

## What Was NOT Built (Correctly Deferred)

- No web search engine integration (SerpAPI, Serper, Tavily, Brave)
- No LinkedIn changes
- No paid data providers
- No campaigns, analytics, email sending
- No Google Maps scraper changes
- No database migration (WEB enum already existed)
- No frontend changes (existing research UI handles multiple sources)

**HARD STOP — Stage 11 scope ends here.**
