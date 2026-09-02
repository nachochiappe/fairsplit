-- Let each user hide monthly flexibility without deleting their private plan.
ALTER TABLE public."PersonalBudgetPlan"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT TRUE;
