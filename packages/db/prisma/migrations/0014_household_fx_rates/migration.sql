DROP INDEX IF EXISTS "MonthlyExchangeRate_month_currencyCode_key";

CREATE UNIQUE INDEX "MonthlyExchangeRate_householdId_month_currencyCode_key"
ON "MonthlyExchangeRate"("householdId", "month", "currencyCode");
