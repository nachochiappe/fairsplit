-- Run this ONLY after verifying backfill output and first-login mapping flow.
BEGIN;

ALTER TABLE "User" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "MonthlyIncome" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "ExpenseTemplate" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "SuperCategory" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "MonthlyExchangeRate" ALTER COLUMN "householdId" SET NOT NULL;

DROP INDEX IF EXISTS "User_authUserId_key";
CREATE UNIQUE INDEX "user_auth_user_id_uq"
ON "User"("authUserId")
WHERE "authUserId" IS NOT NULL;

DROP INDEX IF EXISTS "user_household_email_ci_uq";
CREATE UNIQUE INDEX "user_household_email_ci_uq"
ON "User"("householdId", lower("email"))
WHERE "email" IS NOT NULL;

COMMIT;
