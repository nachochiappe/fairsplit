-- A household-wide split policy keeps custom percentages stable while every
-- monthly settlement continues to be calculated from the underlying records.
CREATE TYPE "SplitMethod" AS ENUM ('income', 'custom');

ALTER TABLE "Household"
ADD COLUMN "splitMethod" "SplitMethod" NOT NULL DEFAULT 'income';

CREATE TABLE "HouseholdSplitShare" (
  "householdId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "percentage" DECIMAL(5, 2) NOT NULL,

  CONSTRAINT "HouseholdSplitShare_pkey" PRIMARY KEY ("householdId", "userId"),
  CONSTRAINT "HouseholdSplitShare_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HouseholdSplitShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HouseholdSplitShare_userId_idx" ON "HouseholdSplitShare"("userId");
