-- Drops Prisma's migration ledger, which no longer records anything.
--
-- `supabase/migrations` is the only history and the Supabase GitHub integration
-- is the only thing that applies it, so `prisma migrate deploy` is gone from the
-- repo. `_prisma_migrations` stopped being written the moment that happened: it
-- ends at 0018, while the real head is 0019 in
-- `supabase_migrations.schema_migrations`. A stale ledger that still looks
-- authoritative is worse than none — anyone reading it would conclude the
-- database is a migration behind.
--
-- It is also the only table in `public` without row level security; every
-- application table has it enabled. This closes that gap by removing the
-- exception rather than papering over it.
--
-- `IF EXISTS` because a database rebuilt from this history never had the table.
-- Prisma created it as a side effect of applying migrations, and nothing does
-- that any more.

DROP TABLE IF EXISTS public."_prisma_migrations";
