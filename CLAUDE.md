# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fairsplit is a household expense splitting app that calculates fair shares based on income ratios. It's a **pnpm monorepo** with:

- `apps/web` — Next.js 15 frontend (App Router)
- `apps/api` — Express.js backend API
- `packages/db` — Prisma ORM + PostgreSQL schema
- `packages/shared` — Settlement algorithm, Zod validation schemas, installment math
- `packages/logging` — Pino-based logging utility

## Commands

```bash
# Development (run all services)
pnpm dev

# Build everything
pnpm build

# Run all tests
pnpm test

# Lint / format
pnpm lint
pnpm format

# Database
pnpm db:migrate       # Run Prisma migrations
pnpm db:generate      # Regenerate Prisma client

# Run API tests only (Vitest integration tests)
cd apps/api && pnpm test

# Run a single test file
cd apps/api && pnpm vitest run src/path/to/test.test.ts
```

Requires Docker for PostgreSQL — start it with `docker-compose up -d` before running locally.

## Architecture

### API (`apps/api/src/app.ts`)
Almost all route handlers live in a single large `app.ts` file. Authentication middleware verifies Supabase JWTs (HS256 or Supabase user endpoint as fallback) and attaches user context. All routes require both a session cookie (`x-fairsplit-session`) and CSRF token.

### Frontend (`apps/web`)
Uses Next.js App Router. `middleware.ts` guards all protected routes, checking session validity and redirecting to login or onboarding as needed. API calls go through `lib/api.ts` (typed fetch client) and `lib/server-api.ts` (server-side). Next.js API routes in `app/api/` act as proxies to the backend.

### Authentication Flow
1. Supabase magic link email → callback route sets session cookie
2. Middleware validates session on each request
3. Backend verifies Supabase JWT on every API call

### Household Onboarding
`POST /api/auth/link` creates a new user with `householdId: null` and
`onboardingHouseholdDecisionAt: null` on purpose. Those two nulls are what
`needsHouseholdSetup` means, and they route the user to
`/onboarding/household`, where they either redeem an invite code
(`join-with-code`) or take a household of their own (`skip-setup`).

Do not give a new user a household at link time. Both onboarding endpoints
refuse a caller that already has one, so doing that makes invite codes
unredeemable — which is what happened between 2af6022 and 0019.

`requireUserContext` tolerates a user without a household;
`requireAuthContext` 403s. Data endpoints use the latter.

Passkeys (WebAuthn) are a secondary sign-in method, implemented with
`@simplewebauthn/*` and no Supabase involvement: a verified assertion is traded
for the same app-issued session token the magic-link flow produces. Enrolment
happens in `/settings` and requires an existing session; sign-in is usernameless
(discoverable credentials, no `allowCredentials`). Challenges live in
`WebAuthnChallenge` and are deleted on consumption so they are single-use.
Requires `FAIRSPLIT_WEBAUTHN_RP_ID` and `FAIRSPLIT_WEBAUTHN_ORIGINS` — the RP ID
scopes credentials, so changing it invalidates every registered passkey.

### Session Revocation
Session tokens carry a `sid` (claims version 2). Logout revokes only the calling
session by inserting a `RevokedSession` row; other devices stay signed in.
`User.sessionRevokedAt` is the account-wide escape hatch behind "log out
everywhere" (`POST /api/auth/logout-all`), invalidating every token issued at or
before it. The web middleware validates only the cookie's signature and expiry,
so a revoked session still reaches a page: SSR reads that get a 401 redirect to
`/session-expired`, which clears the cookies and returns to `/login`. Client
fetches do the same via `ApiError` in `lib/api.ts`.

### Database
Prisma with PostgreSQL. Key models: `User`, `Household`, `MonthlyIncome`, `Expense`, `ExpenseTemplate` (recurring), `Category`/`SuperCategory`, `MonthlyExchangeRate`. The `packages/db` singleton pattern ensures a single Prisma client instance in development.

### Migrations
Two histories describe the same database and must stay in step:
`packages/db/prisma/migrations` (Prisma, the applier) and `supabase/migrations`
(the same SQL, timestamp-prefixed, for the Supabase CLI and preview branches).
Add a migration to both. `supabase migration list` should show Local and Remote
matching on every row.

Never change the schema outside a migration. Every drift this repo has had came
from a hand-run script: `harden-household-auth-link.sql` set `householdId` NOT
NULL across seven tables, was deleted from the repo, and silently broke global
system super categories for five months (see 0018).

`pnpm db:migrate` does not work against the `DATABASE_URL` in `packages/db/.env`:
that is the transaction pooler (`:6543`, `pgbouncer=true`), and `prisma migrate
deploy` needs a session-mode advisory lock, so it hangs with no output. Apply
migrations with the `:5432` session-pooler URL commented beside it.

`DATABASE_URL` points at **production**. Only `TEST_DATABASE_URL` uses the local
docker Postgres.

`SuperCategory.householdId IS NULL` means "global, available to every
household" — it is a value with meaning, not a missing value. Do not make that
column NOT NULL.

### Settlement Algorithm (`packages/shared/src/settlement.ts`)
Calculates each user's fair share of expenses based on their proportion of total household income for a given month. Expenses are normalized to ARS using `MonthlyExchangeRate` before calculation.

### Shared Package (`packages/shared`)
Contains Zod schemas used by both frontend (form validation) and backend (request validation). Import as `@fairsplit/shared`.

## Key Patterns

- **Money precision**: Uses `Decimal.js` throughout — never plain JS floats for monetary values.
- **TypeScript path aliases**: `@fairsplit/db`, `@fairsplit/shared`, `@fairsplit/logging` resolve via `tsconfig.base.json`.
- **Expense types**: One-time, recurring (via `ExpenseTemplate` with optional skip months), and installment-based expenses are all distinct flows.
- **Currency**: Multi-currency support with per-month FX rates; ARS is the base currency for settlement calculations.

## Design Context

### Users
Fairsplit is primarily for couples who share household expenses and want a fair, low-friction way to manage shared money. Their main job is to track expenses during the month and quickly understand the current accumulated total without needing spreadsheet-style effort or repeated money conversations.

### Brand Personality
The product should feel calm and in control. The brand personality is: spend, fair, clear. The interface should reduce friction and ambiguity around shared finances while staying grounded, trustworthy, and practical.

### Aesthetic Direction
The visual direction should remain light-mode first. Existing soft surfaces, rounded shapes, and calm blue-led accents are aligned with the intended tone, but future work should avoid generic "vibecoded app" patterns. The UI should feel deliberate and product-specific rather than trendy, over-ornamented, or interchangeable with other AI-generated SaaS dashboards.

### Design Principles
- Optimize first for couples tracking month-to-date shared expenses and understanding where they stand now.
- Preserve a calm, controlled tone by favoring clear hierarchy, readable totals, and low-friction flows over visual noise.
- Make fairness legible: important numbers, contributions, and monthly accumulation should be obvious at a glance.
- Keep the interface product-specific and intentional; avoid generic, over-stylized, or obviously AI-generated design patterns.
- Stay light-mode first unless a future product decision explicitly broadens the visual system.
