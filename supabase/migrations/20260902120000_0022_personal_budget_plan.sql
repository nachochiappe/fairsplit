-- Store only private planning targets, not itemized personal purchases. The
-- backend scopes every read and write to the authenticated user.
CREATE TABLE "PersonalBudgetPlan" (
  "userId" TEXT NOT NULL,
  "fixedCommitments" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "savingsTarget" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "safetyBuffer" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "averagingMonths" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonalBudgetPlan_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "PersonalBudgetPlan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PersonalBudgetPlan_averagingMonths_check"
    CHECK ("averagingMonths" BETWEEN 1 AND 12),
  CONSTRAINT "PersonalBudgetPlan_fixedCommitments_check" CHECK ("fixedCommitments" >= 0),
  CONSTRAINT "PersonalBudgetPlan_savingsTarget_check" CHECK ("savingsTarget" >= 0),
  CONSTRAINT "PersonalBudgetPlan_safetyBuffer_check" CHECK ("safetyBuffer" >= 0)
);

-- Fairsplit's browser never queries database tables directly. Enabling RLS
-- without public policies keeps these private values backend-only.
ALTER TABLE public."PersonalBudgetPlan" ENABLE ROW LEVEL SECURITY;
