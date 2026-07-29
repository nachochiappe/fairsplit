ALTER TABLE "User"
ADD COLUMN "onboardingHouseholdDecisionAt" TIMESTAMP(3);

CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "consumedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "HouseholdInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HouseholdInvite_code_key" ON "HouseholdInvite"("code");
CREATE INDEX "HouseholdInvite_householdId_expiresAt_idx" ON "HouseholdInvite"("householdId", "expiresAt");
CREATE INDEX "HouseholdInvite_createdByUserId_idx" ON "HouseholdInvite"("createdByUserId");

ALTER TABLE "HouseholdInvite"
ADD CONSTRAINT "HouseholdInvite_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HouseholdInvite"
ADD CONSTRAINT "HouseholdInvite_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HouseholdInvite"
ADD CONSTRAINT "HouseholdInvite_consumedByUserId_fkey"
FOREIGN KEY ("consumedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "User"
SET "onboardingHouseholdDecisionAt" = CURRENT_TIMESTAMP
WHERE "householdId" IS NOT NULL
  AND "onboardingHouseholdDecisionAt" IS NULL;
