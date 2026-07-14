#!/usr/bin/env bash
set -euo pipefail

LIVE_DB_NAME="${LIVE_DB_NAME:-fbcranes}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-atec_restore_test}"
BACKUP_DUMP="${BACKUP_DUMP:-}"
UPLOADS_ARCHIVE="${UPLOADS_ARCHIVE:-}"
RESTORE_UPLOADS_PATH="${RESTORE_UPLOADS_PATH:-/var/www/atec/restore-test-uploads}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-atec_backup}"
EVIDENCE_FILE="${EVIDENCE_FILE:-restore-evidence-$(date -u +%Y%m%d-%H%M%S).txt}"

if [[ -z "$BACKUP_DUMP" ]]; then
  echo "Set BACKUP_DUMP to the .dump file to verify." >&2
  exit 2
fi

if [[ "$RESTORE_DB_NAME" == "$LIVE_DB_NAME" || "$RESTORE_DB_NAME" == "fbcranes" ]]; then
  echo "Refusing to restore into live database '$RESTORE_DB_NAME'." >&2
  exit 3
fi

if [[ ! -f "$BACKUP_DUMP" ]]; then
  echo "Backup dump not found: $BACKUP_DUMP" >&2
  exit 4
fi

{
  echo "ATEC restore verification"
  echo "Started: $(date -u --iso-8601=seconds)"
  echo "Dump: $BACKUP_DUMP"
  echo "Target database: $RESTORE_DB_NAME"
  echo

  if [[ -f "$(dirname "$BACKUP_DUMP")/manifest.sha256" ]]; then
    echo "Verifying SHA256 manifest..."
    (cd "$(dirname "$BACKUP_DUMP")" && sha256sum --check manifest.sha256)
    echo
  else
    echo "No manifest.sha256 found beside dump; skipping checksum verification."
    echo
  fi

  echo "Creating restore database if needed..."
  createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$RESTORE_DB_NAME" 2>/dev/null || true

  echo "Restoring into test database..."
  pg_restore \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$RESTORE_DB_NAME" \
    --clean \
    --if-exists \
    --no-owner \
    "$BACKUP_DUMP"

  echo
  echo "Restored record counts:"
  psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$RESTORE_DB_NAME" --tuples-only --no-align <<'SQL'
SELECT 'clients|' || count(*) FROM atec.tblclients
UNION ALL SELECT 'assets|' || count(*) FROM atec.tblasset
UNION ALL SELECT 'inspections|' || count(*) FROM atec.tblinspection
UNION ALL SELECT 'inspection_results|' || count(*) FROM atec.tblinspectionresult
UNION ALL SELECT 'users|' || count(*) FROM atec.tblusers;
SQL

  if [[ -n "$UPLOADS_ARCHIVE" ]]; then
    if [[ ! -f "$UPLOADS_ARCHIVE" ]]; then
      echo "Uploads archive not found: $UPLOADS_ARCHIVE" >&2
      exit 5
    fi
    mkdir -p "$RESTORE_UPLOADS_PATH"
    tar -C "$RESTORE_UPLOADS_PATH" -xzf "$UPLOADS_ARCHIVE"
    echo
    echo "Uploads restored to test path: $RESTORE_UPLOADS_PATH"
  fi

  echo
  echo "Finished: $(date -u --iso-8601=seconds)"
} | tee "$EVIDENCE_FILE"

echo "Restore evidence saved to: $EVIDENCE_FILE"
