FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl supervisor \
  && rm -rf /var/lib/apt/lists/*

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---------- build ----------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---------- runtime ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV UPLOAD_DIR=/data/uploads

# Static + standalone Next output
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Prisma client + schema for migrations at runtime
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# Worker (run via tsx in dev; in prod we compile-on-start via tsx for simplicity)
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

# supervisord config to run web + worker together
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 3000
CMD ["/start.sh"]
