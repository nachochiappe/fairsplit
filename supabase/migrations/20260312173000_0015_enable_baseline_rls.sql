-- Baseline RLS rollout for Supabase-exposed tables.
-- The application does not use Supabase's generated Data API for app data.
-- All reads and writes go through the backend API, so enabling RLS without
-- public/authenticated policies intentionally blocks direct browser access.

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MonthlyIncome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ExpenseTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RecurringExpenseSkipMonth" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SuperCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MonthlyExchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HouseholdInvite" ENABLE ROW LEVEL SECURITY;
