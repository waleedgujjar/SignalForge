# Module 1 — Authentication, Workspace & User Management

**Status:** Implemented  
**Scope:** Auth, workspace tenancy, roles, onboarding, multi-workspace foundation

## Existing Architecture (Pre-Module 1)

- Monorepo: `apps/web` (Next.js), `apps/api` (Fastify), `packages/auth`, `packages/database`
- Cookie sessions via `sf_session` + `@fastify/cookie`
- scrypt password hashing in `@signalforge/auth`
- Prisma models: User, Workspace, WorkspaceMember, Session
- Partial auth routes: signup (combined), login, logout, session

## Gaps Addressed

| Gap | Resolution |
|-----|------------|
| Combined signup+workspace | Split: signup → onboarding |
| No active workspace in session | `Session.activeWorkspaceId` |
| Missing VIEWER role | Added to MemberRole enum |
| No emailVerifiedAt | Added to User |
| Logout cookie-only | DB session deletion |
| No route protection | Next.js middleware + API guards |
| No workspace switcher | Workspace API + UI |
| No permission utilities | `@signalforge/auth/permissions` |
| Generic auth UI | Premium login/signup/onboarding |

## Module 1 Boundary

**In scope:** Auth, workspace, roles, onboarding, switcher, user menu, authorization middleware.

**Out of scope:** Leads, campaigns, SMTP, verification pipeline, suppression business logic (routes hardened with `requireWorkspace()` only).

## Implementation Plan

See project plan: Module 1 Auth Workspace.

## Risks

- Existing users with workspaces skip onboarding via `onboardingCompletedAt` or membership check
- Workspace ID never trusted from client without membership validation
