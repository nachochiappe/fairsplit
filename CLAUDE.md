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

### Database
Prisma with PostgreSQL. Key models: `User`, `Household`, `MonthlyIncome`, `Expense`, `ExpenseTemplate` (recurring), `Category`/`SuperCategory`, `MonthlyExchangeRate`. The `packages/db` singleton pattern ensures a single Prisma client instance in development.

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
