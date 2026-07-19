#!/usr/bin/env bash
set -euo pipefail

# ATEC live deployment helper.
# Run this on the Ubuntu live server from anywhere:
#   cd /var/www/atec/ATEC
#   bash deployment/deploy-live.sh

PROJECT_DIR="${ATEC_PROJECT_DIR:-/var/www/atec/ATEC}"
PM2_APP="${ATEC_PM2_APP:-atec-backend}"
SITE_URL="${ATEC_SITE_URL:-https://www.atecinspections.co.za}"
API_HEALTH_URL="${ATEC_API_HEALTH_URL:-$SITE_URL/api/health}"
VITE_BASE_PATH="${VITE_BASE_PATH:-/}"
VITE_API_URL="${VITE_API_URL:-$SITE_URL/api}"
FRONTEND_ENV_FILE="$PROJECT_DIR/frontend/.env.production"
ENV_FILE="$PROJECT_DIR/backend/.env"
ENV_BACKUP="$PROJECT_DIR/backend/.env.live.backup"
NPM_LOCK_DRIFT_FILES=(
  "node_modules"
  "backend/node_modules/.package-lock.json"
  "backend/package-lock.json"
  "frontend/package-lock.json"
)

echo "ATEC deploy starting..."
echo "Project: $PROJECT_DIR"

cd "$PROJECT_DIR"

if [ ! -d ".git" ]; then
  echo "ERROR: $PROJECT_DIR is not a Git repository."
  exit 1
fi

for drift_file in "${NPM_LOCK_DRIFT_FILES[@]}"; do
  git restore -- "$drift_file" >/dev/null 2>&1 || true
done

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: The live server has local code changes that would make this deploy unsafe."
  echo "Commit or stash these files first, then rerun the deploy:"
  git status --short --untracked-files=no
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

if grep -q '^BULK_PDF_MAX_CERTIFICATES=' "$ENV_FILE"; then
  sed -i 's/^BULK_PDF_MAX_CERTIFICATES=.*/BULK_PDF_MAX_CERTIFICATES=500/' "$ENV_FILE"
else
  printf '\nBULK_PDF_MAX_CERTIFICATES=500\n' >> "$ENV_FILE"
fi
echo "Bulk certificate PDF limit set to 500."

echo "Installing frontend packages..."
cd "$PROJECT_DIR/frontend"
if [ -f package-lock.json ]; then
  npm ci --include=dev
else
  npm install --include=dev
fi

echo "Building frontend..."
if [ -z "${VITE_GOOGLE_MAPS_API_KEY:-}" ] && [ ! -f "$FRONTEND_ENV_FILE" ]; then
  echo "ERROR: Google Maps is not configured for the production frontend build."
  echo "Set VITE_GOOGLE_MAPS_API_KEY in frontend/.env.production, then rerun this deploy."
  exit 1
fi

if [ -f "$FRONTEND_ENV_FILE" ] && ! grep -Eq '^VITE_GOOGLE_MAPS_API_KEY=.+$' "$FRONTEND_ENV_FILE"; then
  echo "ERROR: VITE_GOOGLE_MAPS_API_KEY is missing or empty in frontend/.env.production."
  exit 1
fi

export VITE_BASE_PATH
export VITE_API_URL
export VITE_GOOGLE_MAPS_API_KEY
echo "Frontend base path: $VITE_BASE_PATH"
echo "Frontend API URL: $VITE_API_URL"
echo "Google Maps configuration: present"
npm run build

echo "Installing backend packages..."
cd "$PROJECT_DIR/backend"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

cd "$PROJECT_DIR"
for drift_file in "${NPM_LOCK_DRIFT_FILES[@]}"; do
  git restore -- "$drift_file" >/dev/null 2>&1 || true
done

echo "Checking production database compatibility..."
echo "Creating a verified pre-migration backup..."
npm run backup:create

echo "Applying approved production migrations..."
node "$PROJECT_DIR/scripts/apply-production-migrations.js"

echo "Verifying the production database schema..."
node "$PROJECT_DIR/scripts/check-production-schema.js"

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
API_STATUS=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  API_STATUS="$(curl -ksS -o /tmp/atec-api-health.out -w "%{http_code}" "$API_HEALTH_URL" || true)"
  if [ "$API_STATUS" = "200" ] || [ "$API_STATUS" = "401" ]; then
    echo "API OK: $API_HEALTH_URL returned HTTP $API_STATUS"
    break
  fi

  echo "API not ready yet, HTTP $API_STATUS. Retrying in 3 seconds... ($attempt/10)"
  sleep 3
done

if [ "$API_STATUS" != "200" ] && [ "$API_STATUS" != "401" ]; then
  echo "ERROR: API health check failed with HTTP $API_STATUS"
  echo "Checked: $API_HEALTH_URL"
  echo "Response:"
  cat /tmp/atec-api-health.out || true
  echo "PM2 status:"
  pm2 status "$PM2_APP" || true
  exit 1
fi

echo "ATEC deploy complete."
