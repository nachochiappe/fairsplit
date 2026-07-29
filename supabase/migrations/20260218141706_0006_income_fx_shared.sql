ALTER TABLE "MonthlyIncome"
ADD COLUMN "amountOriginal" DECIMAL(14,2),
ADD COLUMN "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'ARS',
ADD COLUMN "fxRateUsed" DECIMAL(14,6) NOT NULL DEFAULT 1;

UPDATE "MonthlyIncome"
SET "amountOriginal" = "amount"
WHERE "amountOriginal" IS NULL;

ALTER TABLE "MonthlyIncome"
ALTER COLUMN "amountOriginal" SET NOT NULL;
