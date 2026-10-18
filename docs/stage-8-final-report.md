# Stage 8 Final Report: Lead Finder UI

**Date:** 2026-10-08
**Status:** COMPLETE

---

## Summary

Stage 8 delivers the complete Lead Finder frontend experience. After thorough inspection, the UI already substantially existed under `/leads/discovery/` with 3 pages (search form, job results, history), 14 API client functions, and sidebar navigation. The primary work was gap-filling: lead detail drawer with qualification signals, expanded filter/sort controls, URL state persistence, friendly source labels, job metadata display, clickable links, inline history actions, and unit tests.

---

## Files Changed

| Action | File | What Changed |
|--------|------|--------------|
| MODIFIED | `apps/web/src/app/(app)/leads/page.tsx` | Removed 4 unused variables (`VERIFICATION_BADGE_VARIANT`, `VERIFICATION_LABEL`, `verifyMutation`, `verStatus`) and unused `verifyEmail` import that blocked the `@signalforge/web` build |
| CREATED | `apps/web/src/lib/discovery-display.ts` | Source label mapping (`GOOGLE_MAPS_SCRAPER` → "Google Maps", etc.), `formatDuration()` for human-readable time spans, `SIGNAL_STATUS_ICON` for qualification signal rendering |
| MODIFIED | `apps/web/src/app/(app)/leads/discovery/[jobId]/page.tsx` | Major: lead detail Sheet/drawer, email status filter, sort controls (field + direction), sortable table headers, URL state persistence via `useSearchParams`, Suspense boundary, job metadata (industry, city, state, country, source label, duration), clickable website/email links |
| MODIFIED | `apps/web/src/app/(app)/leads/discovery/history/page.tsx` | Added Actions column with Cancel (PENDING/RUNNING) and Retry (FAILED/PARTIAL) buttons via `useMutation`, applied `sourceLabel()` to Source column, added duration display |
| CREATED | `apps/web/src/lib/discovery-display.test.ts` | 11 unit tests for `sourceLabel()`, `formatDuration()`, and `SIGNAL_STATUS_ICON` |

## Files NOT Modified

- `apps/web/src/app/(app)/leads/discovery/page.tsx` — Search form was already complete (420 lines with source selector, file upload, CSV column mapping, search criteria, filters & limits, submit)
- `apps/web/src/lib/api.ts` — All 14 discovery API functions already existed
- `apps/web/src/components/layout/app-sidebar.tsx` — "Discovery" nav item already present
- `apps/api/` — No backend changes in Stage 8
- `packages/` — No shared package changes
- `packages/database/prisma/schema.prisma` — No migration needed

---

## Pages Implemented

### 1. Search Form (`/leads/discovery`)
**Status: Pre-existing, fully functional**
- Source selector: CSV Import, XLSX Import, Mock (dev), Google Maps (self-hosted scraper), Yelp/Clutch/Yellow Pages (disabled)
- Conditional UI: file sources show upload field, Google Maps shows search criteria (Country, State, City, Industry, Keywords)
- "Filters & limits" collapsible section
- "Discover leads" / "Import leads" submit button with loading state
- "History" button in header

### 2. Job Results (`/leads/discovery/[jobId]`)
**Status: Enhanced with Stage 8 additions**
- **Title**: "Discovery — {friendly source label}" (e.g., "Discovery — Google Maps")
- **Status card**: COMPLETED/RUNNING/FAILED/CANCELLED badge with stats row
- **Job metadata**: Industry, City, State, Country, Source label, Duration
- **Progress bar**: Shown for PENDING/RUNNING jobs with 2s/3s polling
- **Filter bar**: Search input, Qualified-only checkbox, Email Status dropdown (All/Verified/Risky/Invalid/Unknown/Disposable/Role-based), Sort By dropdown (Score/Company/Email/Date), Sort direction toggle (Asc/Desc)
- **Sortable table headers**: Clicking Company/Email/Score columns triggers sort
- **Results table**: Checkbox selection, Company (with domain link), Email (with status badge), Phone, Score, Location
- **Lead detail drawer** (NEW): Sheet that opens on row click showing company, contact, email (mailto link) with status badge, phone (tel link), website (external link), location, industry, qualification score (prominent), qualification status with reason, qualification signals checklist (CheckCircle2/XOctagon/HelpCircle icons), source label, discovered date, "Save to leads" action
- **URL state persistence** (NEW): All filters (page, search, qualified, emailStatus, sortBy, sortOrder) persisted in URL params via `useSearchParams` + `router.replace({ scroll: false })`
- **Suspense boundary**: Required wrapper for `useSearchParams` in Next.js App Router
- **Bulk actions**: Save to leads, Enroll in campaign (pre-existing)
- **Export**: CSV and XLSX buttons (pre-existing)

### 3. Discovery History (`/leads/discovery/history`)
**Status: Enhanced with Stage 8 additions**
- Table columns: Search, Source, Found, Unique, Qualified, Status, Created, Actions
- **Source labels** (NEW): Shows "CSV Import", "Test Data", "Google Maps" instead of raw codes
- **Duration** (NEW): Shows human-readable duration under Created date
- **Actions column** (NEW): Cancel button for PENDING/RUNNING jobs, Retry button for FAILED/PARTIAL jobs, with loading spinners and `e.stopPropagation()` to prevent row navigation
- Status filter dropdown
- Pagination controls
- "New discovery" button in header
- Empty state with CTA to start first discovery

---

## Components Reused

| Component | Source | Usage |
|-----------|--------|-------|
| Sheet/SheetContent/SheetHeader/SheetTitle | `@/components/ui/sheet` | Lead detail drawer |
| PageHeader | `@/components/dashboard/page-header` | All 3 pages |
| EmptyState | `@/components/dashboard/empty-state` | Empty results, empty history |
| Badge | `@/components/ui/badge` | Status, qualification, email, source badges |
| Table/TableBody/TableCell/etc. | `@/components/ui/table` | Results table, history table |
| Select/SelectContent/SelectItem | `@/components/ui/select` | Email status, sort field, status filter |
| Button | `@/components/ui/button` | All action buttons |
| Card | `@/components/ui/card` | Content containers |
| Checkbox | `@/components/ui/checkbox` | Qualified-only filter, row selection |
| Skeleton | `@/components/ui/skeleton` | Loading states |
| Separator | `@/components/ui/separator` | Drawer section dividers |
| Progress | `@/components/ui/progress` | Job progress bar |
| Collapsible | `@/components/ui/collapsible` | Qualification signals |
| CheckCircle2/XOctagon/HelpCircle | `lucide-react` | Signal status icons |
| XCircle/RefreshCw/Loader2 | `lucide-react` | Cancel/Retry/Loading icons |

---

## API Integration

All API calls go through the Next.js proxy (`/api/*` → `localhost:4000/*`). The browser never contacts the scraper directly.

| Frontend Function | Backend Endpoint | Used In |
|-------------------|-----------------|---------|
| `fetchDiscoverySources` | GET `/lead-discovery/sources` | Search form |
| `startDiscoveryJob` | POST `/lead-discovery/jobs` | Search form submit |
| `fetchDiscoveryJob` | GET `/lead-discovery/jobs/:id` | Job results (with polling) |
| `fetchDiscoveryResults` | GET `/lead-discovery/jobs/:id/results` | Results table |
| `fetchDiscoveryJobs` | GET `/lead-discovery/jobs` | History page |
| `cancelDiscoveryJob` | POST `/lead-discovery/jobs/:id/cancel` | Results page, History actions |
| `retryDiscoveryJob` | POST `/lead-discovery/jobs/:id/retry` | Results page, History actions |
| `exportDiscoveryResults` | GET `/lead-discovery/jobs/:id/export` | Export buttons |
| `saveDiscoveredLeads` | POST `/lead-discovery/jobs/:id/save` | Bulk save, drawer save |
| `enrollDiscoveredLeads` | POST `/lead-discovery/jobs/:id/enroll` | Campaign enrollment |
| `importDiscoveryPreview` | POST `/lead-discovery/import/preview` | CSV column mapping |
| `importDiscoveryLeads` | POST `/lead-discovery/import` | CSV/XLSX import |

**Polling pattern**: `refetchInterval: (query) => RUNNING_STATUSES.includes(query.state.data?.status ?? '') ? 2000 : false`

---

## UX Features

1. **URL state persistence** — Filter/sort/page state survives browser refresh and back/forward navigation
2. **Shareable URLs** — e.g., `/leads/discovery/abc?page=2&qualified=true&sortBy=company&sortOrder=asc`
3. **Friendly source labels** — "Google Maps" instead of "GOOGLE_MAPS_SCRAPER"
4. **Human-readable durations** — "2m 30s" instead of raw timestamps
5. **Clickable links** — External website links open in new tab, emails are mailto links, phones are tel links
6. **Qualification signal checklist** — Visual pass/fail/unknown indicators with Lucide icons
7. **Inline history actions** — Cancel/Retry without navigating away from history page
8. **Loading states** — Skeleton placeholders during data fetches, spinner on mutation buttons
9. **Empty states** — Contextual messages with CTAs for empty results and empty history
10. **Responsive table** — `overflow-x-auto` wrapper for horizontal scroll on narrow viewports

---

## Testing

### Unit Tests (11 tests, all passing)
`apps/web/src/lib/discovery-display.test.ts`:

| Test Category | Tests | Coverage |
|---------------|-------|----------|
| sourceLabel | 3 | All 8 known sources + unknown passthrough + empty string |
| formatDuration | 6 | Sub-second, seconds, minutes+seconds, hours+minutes, exact minute, zero duration |
| SIGNAL_STATUS_ICON | 2 | All three statuses exist, exactly three entries |

### Full Test Suite
```
 ✓ src/lib/discovery-display.test.ts (11 tests)
 ✓ src/components/research/research-status.test.ts (21 tests)
 ✓ src/lib/spreadsheet-parser.test.ts (3 tests)

 Test Files  3 passed (3)
      Tests  35 passed (35)
```

### Build Verification
```
 Tasks:    39 successful, 39 total
```
Full monorepo builds with zero TypeScript errors and zero ESLint errors.

### Browser QA

Visual verification performed with full stack (API server + web dev server):

| Check | Result |
|-------|--------|
| Login page renders | PASS |
| Dashboard loads after auth | PASS |
| Sidebar "Discovery" navigation | PASS |
| Search form — source selector dropdown | PASS — shows all sources with friendly labels |
| Search form — Google Maps search criteria fields | PASS — Country, State, City, Industry, Keywords |
| Search form — CSV import with file upload | PASS |
| Search form — Filters & limits collapsible | PASS |
| History page — table with source labels | PASS — "CSV Import", "Test Data" |
| History page — duration display | PASS — "2s" shown under dates |
| History page — status filter | PASS |
| History page — Actions column | PASS (no active jobs to test Cancel; no failed jobs to test Retry) |
| Job results — title with source label | PASS — "Discovery — CSV Import", "Discovery — Test Data" |
| Job results — status badge + stats row | PASS |
| Job results — metadata (Source, Duration) | PASS |
| Job results — filter controls rendered | PASS — Search, Qualified only, Email status, Sort, Direction |
| Job results — data loading | BLOCKED — pre-existing database migration gap (`qualificationVersion` column missing) returns 400 on results query |
| Lead detail drawer | BLOCKED — no results to click (depends on above) |
| React console errors | NONE — clean console |
| Browser only calls SignalForge API | PASS — all requests go through `/api/*` proxy |

**Note**: The results endpoint 400 error is a **pre-existing database migration issue** — the `DiscoveredLead.qualificationVersion` column exists in the Prisma schema but hasn't been applied to this database. This is not a Stage 8 UI bug. The UI gracefully handles the error by showing the empty state message.

---

## Scope Confirmation

### Built (Stage 8)
- Lead detail Sheet/drawer with qualification signals checklist
- Email status filter (Verified/Risky/Invalid/Unknown/Disposable/Role-based)
- Sort controls (Score/Company/Email/Date + Asc/Desc toggle)
- Sortable table headers
- URL state persistence via `useSearchParams`
- Suspense boundary for Next.js App Router
- Job metadata display (industry, location, source label, duration)
- Clickable website links (external), email (mailto), phone (tel)
- Friendly source labels utility (`sourceLabel()`, `formatDuration()`)
- History page inline Cancel/Retry actions
- Discovery display unit tests (11 tests)
- ESLint build fix (removed 4 unused variables)

### NOT Built (Correctly Deferred)
- No Google Places API / Google Maps API key (uses existing self-hosted scraper via backend)
- No scraper exposed to browser (all through `/api/*` proxy)
- No AI enrichment (Stage 10)
- No Website Intelligence (Stage 9)
- No campaign integration beyond what already exists (save + enroll already work)
- No AI/LLM calls from frontend
- No new backend endpoints, queues, or database changes
- No new components created (reused Sheet, Badge, Select, Table, etc.)

---

## Pre-Existing Issues (Not Caused by Stage 8)

1. **Database migration gap**: `DiscoveredLead.qualificationVersion` column in Prisma schema not applied to database. Causes 400 on results query. Requires `pnpm prisma migrate deploy` or `db push`.

2. **`lead-research.test.ts` failures**: 2 pre-existing test failures due to missing `getEnv` export in config mock.

3. **No React Testing Library**: `@testing-library/react` is not installed in the web app, and no `vitest.config` exists for component-level rendering tests. Only pure function tests are possible. Component tests would require adding the library and configuring jsdom environment.

---

**HARD STOP — Stage 8 Complete.**
