#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/var/www/atec/ATEC}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/www/atec/backups}"
UPLOADS_PATH="${UPLOADS_PATH:-$PROJECT_PATH/backend/uploads}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-fbcranes}"
DB_USER="${DB_USER:-atec_backup}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/atec-$TIMESTAMP"
DB_DUMP="$BACKUP_DIR/$DB_NAME-$TIMESTAMP.dump"
UPLOADS_ZIP="$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"
MANIFEST="$BACKUP_DIR/manifest.sha256"
JSON_MANIFEST="$BACKUP_DIR/manifest.json"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "Creating PostgreSQL backup for $DB_NAME on $DB_HOST..."
pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --format=custom \
  --blobs \
  --file="$DB_DUMP" \
  "$DB_NAME"

UPLOADS_INCLUDED=false
if [[ -d "$UPLOADS_PATH" ]] && find "$UPLOADS_PATH" -mindepth 1 -print -quit | grep -q .; then
  echo "Creating uploads backup..."
  tar -C "$UPLOADS_PATH" -czf "$UPLOADS_ZIP" .
  UPLOADS_INCLUDED=true
else
  echo "Uploads folder missing or empty; no uploads archive created."
fi

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$DB_DUMP")" > "$MANIFEST"
  if [[ "$UPLOADS_INCLUDED" == "true" ]]; then
    sha256sum "$(basename "$UPLOADS_ZIP")" >> "$MANIFEST"
  fi
)

cat > "$JSON_MANIFEST" <<EOF
{
  "created_at": "$(date -u --iso-8601=seconds)",
  "database": {
    "host": "$DB_HOST",
    "port": "$DB_PORT",
    "name": "$DB_NAME",
    "user": "$DB_USER",
    "dump_file": "$(basename "$DB_DUMP")"
  },
  "uploads": {
    "source_path": "$UPLOADS_PATH",
    "included": $UPLOADS_INCLUDED,
    "archive_file": "$(if [[ "$UPLOADS_INCLUDED" == "true" ]]; then basename "$UPLOADS_ZIP"; fi)"
  }
}
EOF

echo "Backup completed: $BACKUP_DIR"
echo "Copy this folder off-server, then keep it under the 7 daily / 4 weekly / 12 monthly retention policy."
