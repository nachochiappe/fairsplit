-- Reimbursements are modeled as negative expenses.
-- Keep integrity checks for format/currency/fx/installments, but allow negative Expense amounts.
ALTER TABLE "Expense"
DROP CONSTRAINT IF EXISTS "Expense_amounts_non_negative_check";
