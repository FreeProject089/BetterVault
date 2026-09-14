# syntax=docker/dockerfile:1

# ── Build de l'application web ────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ── Image finale : serveur BetterVault (API + application web) ────────────
# Le serveur n'utilise que les modules intégrés de Node.js : aucun node_modules en production.
FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    BETTERVAULT_DB=/data/bettervault.db \
    BETTERVAULT_STATIC=/app/dist \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

COPY --from=build /app/dist ./dist
COPY server/index.ts ./server/index.ts
COPY server/src ./server/src

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.ts"]
