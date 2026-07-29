-- Performance indexes for observed query patterns
CREATE INDEX IF NOT EXISTS "MonthlyIncome_month_userId_id_idx"
ON "MonthlyIncome"("month", "userId", "id");

CREATE INDEX IF NOT EXISTS "MonthlyIncome_userId_idx"
ON "MonthlyIncome"("userId");

CREATE INDEX IF NOT EXISTS "Category_archivedAt_name_idx"
ON "Category"("archivedAt", "name");

CREATE INDEX IF NOT EXISTS "Expense_templateId_month_idx"
ON "Expense"("templateId", "month");

CREATE INDEX IF NOT EXISTS "Expense_month_date_id_idx"
ON "Expense"("month", "date" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "ExpenseTemplate_isActive_createdAt_idx"
ON "ExpenseTemplate"("isActive", "createdAt");

CREATE INDEX IF NOT EXISTS "ExpenseTemplate_categoryId_idx"
ON "ExpenseTemplate"("categoryId");

-- Partial index for installment series scans
CREATE INDEX IF NOT EXISTS "Expense_installment_series_month_partial_idx"
ON "Expense"("installmentSeriesId", "month", "id")
WHERE "isInstallment" = true AND "installmentSeriesId" IS NOT NULL;

-- Data integrity hardening
ALTER TABLE "MonthlyIncome"
ADD CONSTRAINT "MonthlyIncome_month_format_check"
CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE "MonthlyIncome"
ADD CONSTRAINT "MonthlyIncome_currency_code_check"
CHECK ("currencyCode" IN ('ARS', 'USD', 'EUR')) NOT VALID;

ALTER TABLE "MonthlyIncome"
ADD CONSTRAINT "MonthlyIncome_fx_rate_positive_check"
CHECK ("fxRateUsed" > 0) NOT VALID;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_month_format_check"
CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_currency_code_check"
CHECK ("currencyCode" IN ('ARS', 'USD', 'EUR')) NOT VALID;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_amounts_non_negative_check"
CHECK ("amountOriginal" >= 0 AND "amountArs" >= 0) NOT VALID;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_fx_rate_positive_check"
CHECK ("fxRateUsed" > 0) NOT VALID;

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_installment_consistency_check"
CHECK (
  (
    "isInstallment" = false
    AND "installmentSeriesId" IS NULL
    AND "installmentNumber" IS NULL
    AND "installmentTotal" IS NULL
    AND "installmentAmount" IS NULL
    AND "originalTotalAmount" IS NULL
  )
  OR (
    "isInstallment" = true
    AND "installmentSeriesId" IS NOT NULL
    AND "installmentNumber" IS NOT NULL
    AND "installmentTotal" IS NOT NULL
    AND "installmentAmount" IS NOT NULL
    AND "installmentNumber" >= 1
    AND "installmentTotal" >= "installmentNumber"
  )
) NOT VALID;

ALTER TABLE "ExpenseTemplate"
ADD CONSTRAINT "ExpenseTemplate_currency_code_check"
CHECK ("currencyCode" IN ('ARS', 'USD', 'EUR')) NOT VALID;

ALTER TABLE "ExpenseTemplate"
ADD CONSTRAINT "ExpenseTemplate_amounts_non_negative_check"
CHECK ("amountOriginal" >= 0 AND "amountArs" >= 0) NOT VALID;

ALTER TABLE "ExpenseTemplate"
ADD CONSTRAINT "ExpenseTemplate_fx_rate_positive_check"
CHECK ("fxRate" > 0) NOT VALID;

ALTER TABLE "ExpenseTemplate"
ADD CONSTRAINT "ExpenseTemplate_day_of_month_check"
CHECK ("dayOfMonth" BETWEEN 1 AND 31) NOT VALID;

ALTER TABLE "MonthlyExchangeRate"
ADD CONSTRAINT "MonthlyExchangeRate_month_format_check"
CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE "MonthlyExchangeRate"
ADD CONSTRAINT "MonthlyExchangeRate_currency_code_check"
CHECK ("currencyCode" IN ('ARS', 'USD', 'EUR')) NOT VALID;

ALTER TABLE "MonthlyExchangeRate"
ADD CONSTRAINT "MonthlyExchangeRate_rate_positive_check"
CHECK ("rateToArs" > 0) NOT VALID;
