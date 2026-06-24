#!/usr/bin/env bash
#
# PostgreSQL backup wrapper — replaces the old SQLite VACUUM INTO logic.
# Usage:
# DATABASE_URL=postgres://user:pass@host/db \
# DB_BACKUPS_DIR=./data/backups \
# DB_BACKUP_RETENTION_DAYS=30 \
# bash scripts/backup-pg.sh
#
# Side effects:
# - Creates DB_BACKUPS_DIR/jobs-YYYY-MM-DD.sql (full schema + data dump)
# - Removes .sql files older than DB_BACKUP_RETENTION_DAYS

set -euo pipefail

# Load .env if present (for local cron runs).
if [ -f "$(dirname "$0")/../.env" ]; then
 set -a
 # shellcheck disable=SC1091
 source "$(dirname "$0")/../.env"
 set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required (postgres://user:pass@host/db)}"
: "${DB_BACKUPS_DIR:=./data/backups}"
: "${DB_BACKUP_RETENTION_DAYS:=30}"

mkdir -p "$DB_BACKUPS_DIR"
TODAY=$(date -u +%Y-%m-%d)
BACKUP_PATH="$DB_BACKUPS_DIR/jobs-$TODAY.sql"

# pg_dump: --no-owner (no ALTER OWNER statements), --clean (DROP TABLE before CREATE),
# --if-exists (silent DROP if missing), --no-privileges (skip GRANTs).
pg_dump "$DATABASE_URL" \
 --no-owner \
 --clean \
 --if-exists \
 --no-privileges \
 --file="$BACKUP_PATH"

SIZE=$(stat -c%s "$BACKUP_PATH" 2>/dev/null || stat -f%z "$BACKUP_PATH")
if [ "$SIZE" -eq 0 ]; then
 echo "ERROR: Backup file is empty: $BACKUP_PATH" >&2
 exit 1
fi

echo "Backup created: $BACKUP_PATH ($(($SIZE / 1024)) KB)"

# Remove old backups.
CUTOFF_TS=$(($(date +%s) - DB_BACKUP_RETENTION_DAYS * 24 * 60 * 60))
REMOVED=0
for f in "$DB_BACKUPS_DIR"/jobs-*.sql; do
 [ -f "$f" ] || continue
 FILE_TS=$(stat -c%Y "$f" 2>/dev/null || stat -f%m "$f")
 if [ "$FILE_TS" -lt "$CUTOFF_TS" ]; then
 rm -f "$f"
 REMOVED=$((REMOVED + 1))
 fi
done
if [ "$REMOVED" -gt 0 ]; then
 echo "Old backups removed: $REMOVED"
fi