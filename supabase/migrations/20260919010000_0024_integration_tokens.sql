-- Add revocable, transaction-only credentials for external integrations.
CREATE TABLE "IntegrationToken" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "tokenPrefix" VARCHAR(12) NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "IntegrationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationToken_tokenHash_key" ON "IntegrationToken"("tokenHash");
CREATE INDEX "IntegrationToken_userId_revokedAt_idx" ON "IntegrationToken"("userId", "revokedAt");

ALTER TABLE "IntegrationToken"
  ADD CONSTRAINT "IntegrationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
