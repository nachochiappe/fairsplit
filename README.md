<h1>
  <img src="./apps/web/public/branding/logo-prism-v3-symbol.svg" alt="Fairsplit icon" width="28" height="28" />
  Fairsplit
</h1>

<img width="1477" height="889" alt="image" src="https://github.com/user-attachments/assets/09891b57-30e4-42c4-99d2-5c486e53e3e5" />

Fairsplit helps couples and households split shared expenses based on income, not a flat 50/50 rule.

Track what each person earns, record what the household spends, and end the month with one clear settlement.

## Why People Use Fairsplit

Shared money usually breaks down in one of two ways:

- everything gets split evenly even when incomes are not
- nobody is fully sure what is fair by the end of the month

Fairsplit solves that by turning a messy set of shared expenses into a simple monthly answer:

- what each person should have contributed
- what each person actually paid
- who needs to send money to whom, and how much

## Who It's For

Fairsplit is built for people who share money and want less friction around it:

- couples sharing rent, groceries, bills, and subscriptions
- households where incomes are different and equal splits feel unfair
- anyone who wants a transparent monthly settlement instead of ad hoc IOUs

## How It Works

Most split apps answer "who paid for this?" Fairsplit answers "what is the fair split for the whole month?"

Instead of dividing each expense evenly, Fairsplit:

1. totals the month's income for each person
2. calculates each person's income share
3. applies that share to the month's total shared expenses
4. compares fair contribution vs. what each person actually paid
5. recommends the transfer needed to settle the month

## What You Can Do

- Add monthly incomes for each household member
- Track shared expenses and who paid them
- Handle recurring and installment-based expenses
- Review totals, contribution shares, and transfer recommendations
- Organize spending with categories and category groups
- Invite another person into the same household

## Getting Started

1. Sign in with your email.
2. Join a household with an invite code, or create one during setup.
3. Add incomes for the current month.
4. Record shared expenses as they happen.
5. Open the dashboard to see the final settlement.

## Typical Workflow

### 1. Sign in

Use the email magic link flow to access your household.

### 2. Join or create a household

During setup, you can:

- join an existing household with an invite code
- skip and create a household for yourself

### 3. Add monthly incomes

Each household member records their income for the selected month.

This is what allows Fairsplit to calculate a fair split rather than a fixed percentage.

### 4. Record shared expenses

Add expenses as they happen, including:

- description
- category
- amount
- currency
- who paid
- whether the expense is fixed or part of an installment plan

### 5. Review the settlement

The dashboard shows:

- total household income
- total shared expenses
- each person's fair contribution
- how much each person actually paid
- the final recommended transfer, if one is needed

## What You Can Manage

- your display name
- household invite codes
- expense categories
- category groupings

## Why It Feels Different

Fairsplit is designed around a few product principles:

- fairness should reflect income, not just equal participation
- monthly money conversations should end with one clear answer
- shared finances need transparency without spreadsheet overhead
- recurring household costs should be easy to maintain over time

## Frequently Asked Questions

### Does Fairsplit split every purchase 50/50?

No. It uses each person's share of household income to determine their fair share of the month's total shared expenses.

### Do both people need to log every expense?

No. What matters is that the household's shared expenses and the payer for each one are recorded accurately.

### What if nobody added incomes for the month yet?

Fairsplit can still hold expenses, but it cannot calculate a fair settlement until the month has income data.

### What happens if the month is already balanced?

Fairsplit shows that no transfer is needed.

## For Developers

This repository contains the Fairsplit product codebase. If you are working on the app locally, use the commands below.

### Stack

- `apps/web`: Next.js web app
- `apps/api`: Express API
- `packages/db`: Prisma schema and migrations
- `packages/shared`: shared domain logic and validation

### Run Locally

1. Install dependencies.

```bash
pnpm install
```

2. Start PostgreSQL.

```bash
docker compose up -d
```

3. Configure environment files:

- `apps/web/.env.local`
- `apps/api/.env`
- `packages/db/.env`

4. Prepare the database.

```bash
pnpm db:generate
pnpm db:migrate
```

5. Start the app.

```bash
pnpm dev
```

Default local URLs:

- web: `http://localhost:3000`
- api: `http://localhost:4000/api`

### Quality Checks

```bash
pnpm test
pnpm build
pnpm lint
```

Note: API integration tests require `TEST_DATABASE_URL` and will fail if it is missing or matches `DATABASE_URL`.
