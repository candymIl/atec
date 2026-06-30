#!/usr/bin/env bash
set -u

# ATEC server health check
# Run this on the Ubuntu server to quickly check the important operating items.
#
# Usage:
#   bash /var/www/atec/ATEC/scripts/atec-server-health-check.sh

APP_ROOT="${ATEC_APP_ROOT:-/var/www/atec/ATEC}"
UPLOADS_DIR="${ATEC_UPLOADS_DIR:-$APP_ROOT/uploads}"
BACKUP_DIR="${ATEC_BACKUP_DIR:-/var/www/atec/backups}"
DB_NAME="${DB_NAME:-fbcranes}"

echo "============================================================"
echo "ATEC SERVER HEALTH CHECK"
echo "Generated: $(date)"
echo "============================================================"

echo
echo "DISK SPACE"
df -h /
disk_used_percent="$(df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
if [ "${disk_used_percent:-0}" -ge 85 ]; then
  echo "WARNING: Disk usage is ${disk_used_percent}%. Clean uploads/backups soon."
elif [ "${disk_used_percent:-0}" -ge 75 ]; then
  echo "NOTICE: Disk usage is ${disk_used_percent}%. Keep an eye on uploads and backups."
else
  echo "OK: Disk usage is ${disk_used_percent}%."
fi

echo
echo "MEMORY"
free -h || true

echo
echo "ATEC BACKEND PROCESS"
if command -v pm2 >/dev/null 2>&1; then
  pm2 status atec-backend || pm2 status || true
else
  echo "pm2 is not installed or not available in PATH."
fi

echo
echo "UPLOADS FOLDER SIZE"
if [ -d "$UPLOADS_DIR" ]; then
  du -sh "$UPLOADS_DIR"
  find "$UPLOADS_DIR" -type f | wc -l | awk '{ print "Upload files: " $1 }'
else
  echo "Uploads folder not found: $UPLOADS_DIR"
fi

echo
echo "BACKUPS"
if [ -d "$BACKUP_DIR" ]; then
  du -sh "$BACKUP_DIR"
  echo "Latest backups:"
  find "$BACKUP_DIR" -maxdepth 1 -type f -printf "%TY-%Tm-%Td %TH:%TM  %s bytes  %f\n" 2>/dev/null | sort -r | head -10
else
  echo "Backup folder not found: $BACKUP_DIR"
fi

echo
echo "DATABASE SIZE"
if command -v psql >/dev/null 2>&1; then
  psql -d "$DB_NAME" -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;" || true
else
  echo "psql is not installed or not available in PATH."
fi

echo
echo "HTTP CHECK"
if command -v curl >/dev/null 2>&1; then
  curl -I -s https://www.atecinspections.co.za | head -5 || true
  curl -I -s https://www.atecinspections.co.za/api/ | head -5 || true
else
  echo "curl is not installed or not available in PATH."
fi

echo
echo "DONE"
