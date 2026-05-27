#!/bin/sh
set -e

mkdir -p "${UPLOAD_DIR:-/data/uploads}"

# Run migrations (idempotent)
if [ -n "$DATABASE_URL" ]; then
  echo "Applying Prisma migrations..."
  ./node_modules/.bin/prisma migrate deploy || ./node_modules/.bin/prisma db push --skip-generate
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
