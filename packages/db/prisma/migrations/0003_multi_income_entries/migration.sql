-- Drop one-income-per-user-per-month constraint to allow multiple entries
DROP INDEX IF EXISTS "MonthlyIncome_month_userId_key";
