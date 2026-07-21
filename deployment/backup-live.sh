#!/usr/bin/env bash
set -euo pipefail

# Create a full ATEC database-and-media backup manually on the live server.
# Usage:
#   cd /var/www/atec/ATEC
#   bash deployment/backup-live.sh

PROJECT_DIR="${ATEC_PROJECT_DIR:-/var/www/atec/ATEC}"
ENV_FILE="$PROJECT_DIR/backend/.env"

echo "ATEC manual backup starting..."
echo "Project: $PROJECT_DIR"

cd "$PROJECT_DIR"

if [ ! -f "package.json" ]; then
  echo "ERROR: $PROJECT_DIR does not contain the ATEC package.json file."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE is missing."
  exit 1
fi

npm run backup:create

echo "ATEC manual backup complete."
echo "Run 'npm run backup:status' from $PROJECT_DIR to review available backups."
