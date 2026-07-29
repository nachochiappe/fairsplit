-- Reconciliation of a one-off hardening script that was applied to production
-- but never captured as a migration.
--
-- The SQL below is `packages/db/prisma/harden-household-auth-link.sql`, which was
-- run by hand after `backfill-household-auth-link.ts` populated `householdId`,
-- then deleted from the repo in 9726927 ("Remove backfill and hardening scripts
-- for household authentication"). Production carries these changes; the migration
-- history did not, so a database rebuilt from migrations diverged from production.
--
-- Placed directly after 0010_households_auth_linking, which adds all seven
-- `householdId` columns and the index this replaces.
--
-- Two statements from the original script are omitted:
--
--   * `user_household_email_ci_uq` — 0010 already creates that index identically.
--
--   * `ALTER TABLE "SuperCategory" … SET NOT NULL` — deliberately dropped. A NULL
--     `householdId` is how a system super category is marked global, so that
--     statement broke the feature in production; 0018 undoes it. Reproducing it
--     here would make every rebuilt database fail on the six rows 0009 seeds.

ALTER TABLE "User" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "MonthlyIncome" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "ExpenseTemplate" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "MonthlyExchangeRate" ALTER COLUMN "householdId" SET NOT NULL;

-- Replaces the plain unique index with a partial one so multiple users may sit
-- unlinked (`authUserId IS NULL`) while linked ids stay unique.
DROP INDEX IF EXISTS "User_authUserId_key";
CREATE UNIQUE INDEX "user_auth_user_id_uq"
ON "User"("authUserId")
WHERE "authUserId" IS NOT NULL;
