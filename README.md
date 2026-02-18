# FairSplit MVP

A monorepo web-first app to track monthly incomes and expenses, then compute fair end-of-month settlement based on income proportion.

## Stack

- `apps/web`: Next.js App Router, TypeScript, Tailwind, React Hook Form + Zod
- `apps/api`: Express + TypeScript + Prisma client
- `packages/db`: Prisma schema and SQL migrations
- `packages/shared`: Shared validation + settlement logic + unit tests
- Database: PostgreSQL (local Docker for dev, or hosted Postgres like Supabase)

## Settlement Logic

Given a selected month:

- `totalIncome = sum(incomes)`
- `totalExpenses = sum(expenses)`
- `expenseRatio = totalExpenses / totalIncome`
- `fairContribution(user) = income(user) * expenseRatio`
- `paid(user) = sum(expenses where paidBy=user)`
- `difference(user) = paid(user) - fairContribution(user)`
  - `difference > 0`: user should receive money
  - `difference < 0`: user should send money
- Transfer amount uses rounded differences:
  - high precision internal math (`decimal.js`)
  - values presented at 2 decimals
  - transfer is min(abs(most negative rounded difference), most positive rounded difference)

## Numeric + Rounding Policy

- Database uses Postgres `numeric` via Prisma `Decimal`.
- API returns all amount-like fields as **strings** (e.g. `"123.45"`).
- Internally uses decimal-safe math and rounds output to 2 decimals.

## Data Model

- `Household`: top-level tenant boundary.
- `User`: participant with optional auth linkage (`email`, `authUserId`) and `householdId`.
- `MonthlyIncome`: income rows per user/month, household-scoped.
- `Expense`: expense rows per month, household-scoped.
  - Optional installment metadata: `isInstallment`, `installmentSeriesId`, `installmentNumber`, `installmentTotal`, `installmentAmount`, `installmentSource`, `originalTotalAmount`, `createdFromSeries`
- `Category`, `SuperCategory`, `ExpenseTemplate`, `MonthlyExchangeRate`: household-scoped.

Constraints:

- multiple `MonthlyIncome` rows are allowed per `month + userId`
- one non-null `authUserId` maps to exactly one `User`
- one non-null email per household (case-insensitive)

## API

Base URL: `http://localhost:4000/api`

- `GET /months`
- `GET /users`
- `POST /users`
- `POST /auth/link` (link/create user from auth callback)
- `GET /incomes?month=YYYY-MM`
- `PUT /incomes` (replace all income entries for one user in a month)
- `GET /expenses?month=YYYY-MM`
- `POST /expenses`
- `PUT /expenses/:id`
- `DELETE /expenses/:id`
- `GET /settlement?month=YYYY-MM`

Settlement response:

```json
{
  "month": "2026-02",
  "totalIncome": "9000.00",
  "totalExpenses": "3300.00",
  "expenseRatio": "0.366667",
  "fairShareByUser": { "user-a": "2200.00", "user-b": "1100.00" },
  "paidByUser": { "user-a": "2400.00", "user-b": "900.00" },
  "differenceByUser": { "user-a": "200.00", "user-b": "-200.00" },
  "transfer": {
    "fromUserId": "user-b",
    "toUserId": "user-a",
    "amount": "200.00"
  }
}
```

## Environment Setup

Use per-workspace env files in this monorepo:

- `apps/web/.env.local`
- `apps/api/.env`
- `packages/db/.env`

Example values:

`apps/web/.env.local`

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`apps/api/.env`

```bash
DATABASE_URL=postgresql://... # local or hosted Postgres
API_PORT=4000
```

`packages/db/.env`

```bash
DATABASE_URL=postgresql://... # local or hosted Postgres
TEST_DATABASE_URL=postgresql://... # required for API integration tests
```

## Local Setup (Docker Postgres)

1. Install dependencies:

```bash
pnpm install
```

2. Start local PostgreSQL:

```bash
docker compose up -d
```

3. Apply migration and generate Prisma client:

```bash
pnpm db:generate
pnpm db:migrate
```

4. Run API + web together:

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api`

## Auth (Magic Link)

The web app now starts at a login flow (`/login`) when no session cookie is present.

After clicking the magic link, `/auth/callback` calls `POST /api/auth/link` to map or create the FairSplit user and store a session cookie.

If Supabase redirects to `/login#access_token=...`, the login page auto-forwards to `/auth/callback`.

## Supabase Migration + Data Import (recommended order)

1. Point `apps/api/.env` and `packages/db/.env` `DATABASE_URL` to Supabase (`sslmode=require`).
2. Run migrations:

```bash
pnpm db:migrate
```

3. Import existing local data as data-only:

```bash
pg_dump -n public --data-only --exclude-table=public._prisma_migrations --exclude-table-data=public.\"SuperCategory\" \
  \"postgresql://postgres:postgres@localhost:5433/fairsplit\" > /tmp/fairsplit_data.sql
psql \"postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require\" < /tmp/fairsplit_data.sql
```

## Tests + Build

- Run all tests:

```bash
pnpm test
```

- API integration tests require `TEST_DATABASE_URL` and will refuse to run if it is missing
  or equal to `DATABASE_URL`.
  Example:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/fairsplit_test?schema=public pnpm --filter @fairsplit/api test
```

- Run all builds:

```bash
pnpm build
```

- Run lint:

```bash
pnpm lint
```

## Notes

- If `totalIncome == 0` and expenses are non-zero, settlement endpoint returns `400` with a friendly message.
- Installments are first-class expenses. Future installments are generated lazily when a month is fetched.
- Logout route: `GET /logout` clears the local session cookie.
