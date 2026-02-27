# Fairsplit

Fairsplit helps households split shared expenses in a way that feels fair, transparent, and easy to settle.

Instead of splitting everything 50/50, Fairsplit uses each person’s monthly income to calculate how much each person should contribute, then tells you exactly who pays whom at month-end.

## Why Fairsplit

Managing shared money gets messy fast. Fairsplit is designed to reduce friction by making three things simple:

- Track what came in (incomes)
- Track what went out (shared expenses)
- Settle up with one clear transfer recommendation

## Product Highlights

- Income-based fairness: contributions scale by each person’s income share
- Clear monthly settlement: know exactly who should send and receive money
- Household-oriented model: data is scoped per household
- Recurring-friendly tracking: supports fixed and installment-based expenses
- Login flow with magic link support via Supabase

## How It Works

1. Choose a month.
2. Add each person’s income entries for that month.
3. Add shared expenses and who paid for each one.
4. Fairsplit calculates each person’s fair contribution.
5. Fairsplit shows the settlement transfer needed to balance the month.

## Tech Snapshot

- `apps/web`: Next.js + TypeScript UI
- `apps/api`: Express + TypeScript API
- `packages/db`: Prisma schema + migrations
- `packages/shared`: shared business logic and validation
- Database: PostgreSQL (local Docker or hosted, e.g. Supabase)

## Run Locally

1. Install dependencies:

```bash
pnpm install
```

2. Start PostgreSQL:

```bash
docker compose up -d
```

3. Prepare database:

```bash
pnpm db:generate
pnpm db:migrate
```

4. Configure environment files:

- `apps/web/.env.local`
- `apps/api/.env`
- `packages/db/.env`

Example:

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000

# apps/api/.env
DATABASE_URL=postgresql://...
API_PORT=4000

# packages/db/.env
DATABASE_URL=postgresql://...
TEST_DATABASE_URL=postgresql://...
```

5. Start web + API:

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api`

## Authentication

- Unauthenticated users are redirected to `/login`
- Login uses magic links
- Callback flow maps or creates a Fairsplit user and sets a session cookie

## Quality Checks

```bash
pnpm test
pnpm build
pnpm lint
```

Note: API integration tests require `TEST_DATABASE_URL` and will fail if it is missing or matches `DATABASE_URL`.

## Real Email E2E (AgentMail)

Run:

```bash
pnpm test:e2e:agentmail:onboarding
```

Required env vars:
- `AGENTMAIL_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional overrides:
- `E2E_APP_URL` (default `http://localhost:3100`)
- `E2E_API_BASE_URL` (default `http://localhost:4100/api`)
- `E2E_EMAIL_TIMEOUT_MS` (default `300000`)
- `E2E_EMAIL_POLL_MS` (default `3000`)
- `E2E_AGENTMAIL_INVITER_INBOX_ID` and `E2E_AGENTMAIL_JOINER_INBOX_ID` (optional, useful when AgentMail inbox creation limit is reached)
- `E2E_FORCE_LOCAL_CALLBACK` (default `true`, rewrites Supabase verify links to local `/auth/callback`)

This test:
- Requests real Supabase magic links to AgentMail inboxes.
- Completes both user logins through callback links in browser (`playwright-cli`).
- Generates an invite from user A household.
- Uses user B onboarding UI to join with invite code.
- Verifies setup is completed and locked for user B.

Important:
- Keep web/API dev servers on the same ports used by the test (`3100` and `4100`), or explicitly set `E2E_APP_URL`/`E2E_API_BASE_URL`.
