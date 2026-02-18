-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseTemplate" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountOriginal" DECIMAL(14,2) NOT NULL,
    "amountArs" DECIMAL(14,2) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "fxRate" DECIMAL(14,6) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "paidByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyExchangeRate" (
    "id" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "rateToArs" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyExchangeRate_pkey" PRIMARY KEY ("id")
);

-- Add columns for new expense model
ALTER TABLE "Expense"
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "amountOriginal" DECIMAL(14,2),
ADD COLUMN "amountArs" DECIMAL(14,2),
ADD COLUMN "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'ARS',
ADD COLUMN "fxRateUsed" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN "templateId" TEXT;

-- Required for ON CONFLICT ("name") during backfill
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- Backfill categories from free-text values
INSERT INTO "Category" ("id", "name", "createdAt", "updatedAt")
SELECT CONCAT('cat_', md5(category)), category, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT category FROM "Expense") AS c
WHERE c.category IS NOT NULL
ON CONFLICT ("name") DO NOTHING;

UPDATE "Expense" e
SET "categoryId" = c."id"
FROM "Category" c
WHERE c."name" = e."category";

-- Backfill amounts and FX fields
UPDATE "Expense"
SET "amountOriginal" = "amount",
    "amountArs" = "amount",
    "fxRateUsed" = 1,
    "currencyCode" = 'ARS'
WHERE "amountOriginal" IS NULL OR "amountArs" IS NULL;

ALTER TABLE "Expense"
ALTER COLUMN "categoryId" SET NOT NULL,
ALTER COLUMN "amountOriginal" SET NOT NULL,
ALTER COLUMN "amountArs" SET NOT NULL;

-- Drop old free-text/category + single amount fields
ALTER TABLE "Expense"
DROP COLUMN "category",
DROP COLUMN "amount";

-- Indexes
CREATE INDEX "ExpenseTemplate_isActive_idx" ON "ExpenseTemplate"("isActive");
CREATE INDEX "ExpenseTemplate_paidByUserId_idx" ON "ExpenseTemplate"("paidByUserId");
CREATE UNIQUE INDEX "MonthlyExchangeRate_month_currencyCode_key" ON "MonthlyExchangeRate"("month", "currencyCode");
CREATE INDEX "MonthlyExchangeRate_month_idx" ON "MonthlyExchangeRate"("month");
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");
CREATE INDEX "Expense_templateId_idx" ON "Expense"("templateId");
CREATE INDEX "Expense_month_templateId_idx" ON "Expense"("month", "templateId");
CREATE UNIQUE INDEX "Expense_month_templateId_key" ON "Expense"("month", "templateId");

-- Foreign keys
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExpenseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
