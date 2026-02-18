# FairSplit MVP

A monorepo web-first app for two partners to track monthly incomes and expenses, then compute fair end-of-month settlement based on income proportion.

## Stack

- `apps/web`: Next.js App Router, TypeScript, Tailwind, React Hook Form + Zod
- `apps/api`: Express + TypeScript + Prisma client
- `packages/db`: Prisma schema, SQL migration, seed script
- `packages/shared`: Shared validation + settlement logic + unit tests
- Database: PostgreSQL (Docker Compose)

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

- `User`: `id`, `name`, `createdAt`
- `MonthlyIncome`: `id`, `month` (`YYYY-MM`), `userId`, `amount`
- `Expense`: `id`, `month`, `date`, `description`, `category`, `amount`, `paidByUserId`
  - Optional installment metadata: `isInstallment`, `installmentSeriesId`, `installmentNumber`, `installmentTotal`, `installmentAmount`, `installmentSource`, `originalTotalAmount`, `createdFromSeries`

Constraints:

- multiple `MonthlyIncome` rows are allowed per `month + userId`
- amount fields validated as `>= 0` at API layer

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

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start PostgreSQL:

```bash
docker compose up -d
```

3. Apply migration and generate Prisma client:

```bash
pnpm db:generate
pnpm db:migrate
```

4. Seed sample data (current month):

```bash
pnpm db:seed
```

5. Run API + web together:

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api`

## Auth (Magic Link)

The web app now starts at a login flow (`/login`) when no session cookie is present.

Set these in your web environment:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

After clicking the magic link, `/auth/callback` calls `POST /api/auth/link` to map or create the FairSplit user.

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

## Seeded Sample

Seed creates two users (`Alex`, `Sam`) for the current month with incomes and expenses so dashboard settlement is visible immediately.

## Notes

- This MVP models two users in seeded UI flow but schema and settlement logic support multiple users.
- If `totalIncome == 0` and expenses are non-zero, settlement endpoint returns `400` with a friendly message.
- Installments are first-class expenses. Future installments are generated lazily when a month is fetched.
- Legacy descriptions like `C.17/18` can be backfilled with:

```bash
pnpm --filter @fairsplit/db backfill:installments
```

- Household/auth backfill for existing Nacho/Tatiana data:

```bash
pnpm db:migrate
pnpm --filter @fairsplit/db backfill:household-auth-link
```

- After validating linked users and first-login behavior, run hardening SQL manually:

```bash
psql "$DATABASE_URL" -f packages/db/prisma/harden-household-auth-link.sql
```
