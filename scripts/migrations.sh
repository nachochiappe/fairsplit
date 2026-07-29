#!/usr/bin/env bash
#
# Migration tooling. `supabase/migrations` is the only migration history, and the
# Supabase GitHub integration is the only thing that applies it to production —
# merging to main deploys. Nothing here touches production.
#
#   ./scripts/migrations.sh new <name>    author a migration from schema.prisma
#   ./scripts/migrations.sh replay <url>  build a database from the full history
#   ./scripts/migrations.sh reset-test    rebuild the test database
#   ./scripts/migrations.sh verify        check schema.prisma matches the history
#
# `new` works by diffing schema.prisma against a shadow database built from the
# existing history, so the generated SQL is exactly the gap between them. Edit
# schema.prisma first, then run it.
set -euo pipefail

cd "$(dirname "$0")/.."

MIGRATIONS_DIR="supabase/migrations"
SCHEMA="prisma/schema.prisma"
SHADOW_DB="fairsplit_shadow"
KNOWN_DRIFT="packages/db/prisma/known-drift.sql"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

# The Supabase CLI insists on TLS for --db-url, which a local Postgres does not
# offer, so migrations are replayed with psql. A shadow database only needs to
# reach head; the supabase_migrations ledger is irrelevant off the real remote.
require_psql() {
  command -v psql >/dev/null 2>&1 || die 'psql not found (brew install postgresql@17, or apt install postgresql-client)'
}

# The environment wins so CI, which has no packages/db/.env, can supply it.
test_url() {
  local url="${TEST_DATABASE_URL:-}"
  if [ -z "$url" ]; then
    url=$(grep -E '^TEST_DATABASE_URL=' packages/db/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')
  fi
  [ -n "$url" ] || die 'set TEST_DATABASE_URL, or put it in packages/db/.env'
  printf '%s' "$url" | sed -E 's/\?.*$//'
}

# Same server, `postgres` database — needed to CREATE/DROP another database.
admin_url() { printf '%s' "$(test_url)" | sed -E 's#/[^/]+$#/postgres#'; }
sibling_url() { printf '%s' "$(test_url)" | sed -E "s#/[^/]+\$#/$1#"; }

replay() {
  local url="$1" count=0
  shopt -s nullglob
  for f in "$MIGRATIONS_DIR"/*.sql; do
    psql "$url" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "failed applying $(basename "$f")"
    count=$((count + 1))
  done
  shopt -u nullglob
  [ "$count" -gt 0 ] || die "no migrations found in $MIGRATIONS_DIR"
  note "applied $count migrations"
}

# The shadow is the history plus the drift we have accepted, so a diff against
# schema.prisma is only ever the change being authored. Without the second step,
# every generated migration would carry the known drift along with it.
recreate_shadow() {
  psql "$(admin_url)" -q -c "DROP DATABASE IF EXISTS $SHADOW_DB;" -c "CREATE DATABASE $SHADOW_DB;" 2>/dev/null
  replay "$(sibling_url "$SHADOW_DB")"
  psql "$(sibling_url "$SHADOW_DB")" -v ON_ERROR_STOP=1 -q -f "$KNOWN_DRIFT" >/dev/null \
    || die "failed applying $KNOWN_DRIFT to the shadow database"
}

drop_shadow() {
  psql "$(admin_url)" -q -c "DROP DATABASE IF EXISTS $SHADOW_DB;" 2>/dev/null || true
}

# Prints the SQL needed to take $1 to the state schema.prisma describes, or
# nothing at all. Prisma emits "-- This is an empty migration." for no difference.
diff_to_schema() {
  (cd packages/db && pnpm --silent exec prisma migrate diff \
    --from-url "$1" --to-schema-datamodel "$SCHEMA" --script) \
    | grep -vE '^-- This is an empty migration\.$'
}

cmd_new() {
  local name="${1:-}"
  [ -n "$name" ] || die 'usage: ./scripts/migrations.sh new <name>'
  case "$name" in
    *[^a-z0-9_]*) die 'name should be lower_snake_case' ;;
  esac
  require_psql

  note 'building shadow database from the existing history'
  recreate_shadow
  local shadow; shadow=$(sibling_url "$SHADOW_DB")

  local version file
  version=$(date -u +%Y%m%d%H%M%S)
  file="$MIGRATIONS_DIR/${version}_${name}.sql"

  note 'diffing schema.prisma against it'
  diff_to_schema "$shadow" > "$file"

  if ! grep -qE '[^[:space:]]' "$file"; then
    rm -f "$file"
    drop_shadow
    die 'schema.prisma already matches the history — nothing to migrate'
  fi

  # A migration that does not close the gap it was generated from is not usable.
  note 'verifying it reaches the schema'
  psql "$shadow" -v ON_ERROR_STOP=1 -q -f "$file" >/dev/null || {
    printf 'generated SQL failed to apply; left at %s for inspection\n' "$file" >&2
    exit 1
  }
  local remaining; remaining=$(diff_to_schema "$shadow")
  [ -z "$remaining" ] || {
    printf 'schema still differs after applying; left at %s\n%s\n' "$file" "$remaining" >&2
    exit 1
  }

  drop_shadow
  printf '\n%s\n' "$file"
  printf 'Review it, add a comment saying why, then commit. Merging to main deploys it.\n'
}

cmd_replay() {
  local url="${1:-}"
  [ -n "$url" ] || die 'usage: ./scripts/migrations.sh replay <database-url>'
  require_psql
  replay "$url"
}

cmd_reset_test() {
  require_psql
  local url db
  url=$(test_url)
  db=$(printf '%s' "$url" | sed -E 's#.*/##')
  case "$url" in
    *localhost*|*127.0.0.1*) ;;
    *) die "refusing to reset a non-local database: $db" ;;
  esac
  note "recreating $db"
  psql "$(admin_url)" -q -c "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;" 2>/dev/null
  replay "$url"
}

cmd_verify() {
  require_psql
  note 'building shadow database from the history'
  recreate_shadow
  local drift; drift=$(diff_to_schema "$(sibling_url "$SHADOW_DB")")
  drop_shadow

  if [ -n "$drift" ]; then
    printf '\nschema.prisma does not match the migration history:\n\n%s\n\n' "$drift" >&2
    printf 'Either fix schema.prisma, add a migration, or — if Prisma cannot express\n' >&2
    printf 'it — document it in %s.\n' "$KNOWN_DRIFT" >&2
    exit 1
  fi
  printf '\nschema.prisma matches the migration history\n'
}

case "${1:-}" in
  new) shift; cmd_new "$@" ;;
  replay) shift; cmd_replay "$@" ;;
  reset-test) shift; cmd_reset_test "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'
    exit 1
    ;;
esac
