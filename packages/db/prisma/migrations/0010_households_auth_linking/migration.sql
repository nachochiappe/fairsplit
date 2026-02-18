-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- Add household + auth identity columns
ALTER TABLE "User"
ADD COLUMN "email" TEXT,
ADD COLUMN "authUserId" TEXT,
ADD COLUMN "householdId" TEXT;

ALTER TABLE "MonthlyIncome"
ADD COLUMN "householdId" TEXT;

ALTER TABLE "Expense"
ADD COLUMN "householdId" TEXT;

ALTER TABLE "ExpenseTemplate"
ADD COLUMN "householdId" TEXT;

ALTER TABLE "Category"
ADD COLUMN "householdId" TEXT;

ALTER TABLE "SuperCategory"
ADD COLUMN "householdId" TEXT;

ALTER TABLE "MonthlyExchangeRate"
ADD COLUMN "householdId" TEXT;

-- Rework uniqueness to be household-scoped where applicable
DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "SuperCategory_slug_key";
DROP INDEX IF EXISTS "MonthlyExchangeRate_month_currencyCode_key";

CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");
CREATE UNIQUE INDEX "SuperCategory_householdId_slug_key" ON "SuperCategory"("householdId", "slug");
CREATE UNIQUE INDEX "MonthlyExchangeRate_month_currencyCode_key"
ON "MonthlyExchangeRate"("month", "currencyCode");

-- User identity uniqueness
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
CREATE UNIQUE INDEX "user_household_email_ci_uq"
ON "User"("householdId", lower("email"))
WHERE "email" IS NOT NULL;

-- Tenant access indexes
CREATE INDEX "User_householdId_idx" ON "User"("householdId");
CREATE INDEX "MonthlyIncome_householdId_idx" ON "MonthlyIncome"("householdId");
CREATE INDEX "MonthlyIncome_householdId_month_idx" ON "MonthlyIncome"("householdId", "month");
CREATE INDEX "Expense_householdId_idx" ON "Expense"("householdId");
CREATE INDEX "Expense_householdId_month_idx" ON "Expense"("householdId", "month");
CREATE INDEX "ExpenseTemplate_householdId_idx" ON "ExpenseTemplate"("householdId");
CREATE INDEX "Category_householdId_idx" ON "Category"("householdId");
CREATE INDEX "SuperCategory_householdId_idx" ON "SuperCategory"("householdId");
CREATE INDEX "MonthlyExchangeRate_householdId_idx" ON "MonthlyExchangeRate"("householdId");

-- Foreign keys
ALTER TABLE "User"
ADD CONSTRAINT "User_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MonthlyIncome"
ADD CONSTRAINT "MonthlyIncome_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExpenseTemplate"
ADD CONSTRAINT "ExpenseTemplate_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Category"
ADD CONSTRAINT "Category_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SuperCategory"
ADD CONSTRAINT "SuperCategory_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MonthlyExchangeRate"
ADD CONSTRAINT "MonthlyExchangeRate_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;
