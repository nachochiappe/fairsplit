CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevokedSession_sessionId_key" ON "RevokedSession"("sessionId");
-- Serves both the per-request revocation lookup and the pruning of lapsed rows.
CREATE INDEX "RevokedSession_userId_expiresAt_idx" ON "RevokedSession"("userId", "expiresAt");

ALTER TABLE "RevokedSession"
ADD CONSTRAINT "RevokedSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Matches the baseline RLS rollout: this table is never read through Supabase's
-- Data API, so enabling RLS without policies blocks direct browser access.
ALTER TABLE "RevokedSession" ENABLE ROW LEVEL SECURITY;
