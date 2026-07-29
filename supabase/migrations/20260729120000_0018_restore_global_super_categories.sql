-- Restores system super categories to being global.
--
-- A super category is available to every household precisely because its
-- `householdId` is NULL: the read path in `GET /api/super-categories` (and the
-- three validation sites alongside it) matches
--   OR [{ householdId: <caller> }, { householdId: NULL, isSystem: true }]
--
-- `harden-household-auth-link.sql` (run by hand 2026-02-18, deleted from the repo
-- in 9726927) set `householdId` NOT NULL across every household-scoped table. A
-- NOT NULL column cannot hold the value that means "global", so the accompanying
-- backfill gave the six seeded system rows an owner. That turned them from global
-- into the property of one household, and the NULL branch above has matched zero
-- rows ever since — every other household saw no system super categories at all.
--
-- NOT NULL remains correct for the other six tables that script touched; each of
-- their rows genuinely belongs to exactly one household. `SuperCategory` was the
-- only table where NULL carried meaning.

-- Order matters: the constraint has to go before the rows can be nulled.
ALTER TABLE "SuperCategory" ALTER COLUMN "householdId" DROP NOT NULL;

UPDATE "SuperCategory" SET "householdId" = NULL WHERE "isSystem";

-- `@@unique([householdId, slug])` cannot constrain the global rows: Postgres treats
-- NULLs as distinct, so it would admit a second global 'housing'. A partial index
-- over the global rows closes that, and still lets a household define its own super
-- category reusing a system slug.
CREATE UNIQUE INDEX "super_category_system_slug_uq"
ON "SuperCategory"("slug")
WHERE "householdId" IS NULL;
