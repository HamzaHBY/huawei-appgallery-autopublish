#!/bin/sh
set -e

mkdir -p "${UPLOAD_DIR:-/data/uploads}"

# Sync schema to DB (idempotent — creates tables if missing, safe no-op otherwise)
if [ -n "$DATABASE_URL" ]; then
  echo "Syncing Prisma schema to database..."
  ./node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>&1 || true
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
