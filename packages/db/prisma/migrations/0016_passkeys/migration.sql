CREATE TABLE "UserPasskey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" VARCHAR(16) NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "UserPasskey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPasskey_credentialId_key" ON "UserPasskey"("credentialId");
CREATE INDEX "UserPasskey_userId_idx" ON "UserPasskey"("userId");

ALTER TABLE "UserPasskey"
ADD CONSTRAINT "UserPasskey_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" VARCHAR(16) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- Matches the baseline RLS rollout: these tables are never read through
-- Supabase's Data API, so enabling RLS without policies blocks direct browser
-- access to credential public keys and in-flight challenges.
ALTER TABLE "UserPasskey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebAuthnChallenge" ENABLE ROW LEVEL SECURITY;
