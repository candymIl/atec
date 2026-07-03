#!/usr/bin/env bash
set -euo pipefail

# ATEC live deployment helper.
# Run this on the Ubuntu live server from anywhere:
#   cd /var/www/atec/ATEC
#   bash deployment/deploy-live.sh

PROJECT_DIR="${ATEC_PROJECT_DIR:-/var/www/atec/ATEC}"
PM2_APP="${ATEC_PM2_APP:-atec-backend}"
SITE_URL="${ATEC_SITE_URL:-https://www.atecinspections.co.za}"
API_URL="${ATEC_API_URL:-https://www.atecinspections.co.za/api/}"
ENV_FILE="$PROJECT_DIR/backend/.env"
ENV_BACKUP="$PROJECT_DIR/backend/.env.live.backup"

echo "ATEC deploy starting..."
echo "Project: $PROJECT_DIR"

cd "$PROJECT_DIR"

if [ ! -d ".git" ]; then
  echo "ERROR: $PROJECT_DIR is not a Git repository."
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_BACKUP"
  echo "Live backend .env backed up."
elif [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" "$ENV_FILE"
  echo "Live backend .env restored from backup."
else
  echo "ERROR: backend/.env is missing and no backend/.env.live.backup was found."
  echo "Create backend/.env first, then rerun this deploy."
  exit 1
fi

echo "Pulling latest code..."
git pull --no-rebase

if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" "$ENV_FILE"
  echo "Live backend .env restored after pull."
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: backend/.env is missing after pull."
  exit 1
fi

echo "Installing frontend packages..."
cd "$PROJECT_DIR/frontend"
npm install

echo "Building frontend..."
npm run build

echo "Installing backend packages..."
cd "$PROJECT_DIR/backend"
npm install

echo "Restarting backend..."
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  echo "ERROR: PM2 app '$PM2_APP' was not found."
  echo "Start it manually first, then rerun this deploy."
  exit 1
fi

pm2 status

echo "Checking website..."
curl -fsSI "$SITE_URL" >/dev/null
echo "Website OK: $SITE_URL"

echo "Checking API..."
curl -fsSI "$API_URL" >/dev/null
echo "API OK: $API_URL"

echo "ATEC deploy complete."
