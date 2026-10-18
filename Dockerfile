# syntax=docker/dockerfile:1

# ---- 1. build the web app (type-check + production bundle) ----
FROM node:26-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. runtime: tiny Node server + the built app, no build tools, no dev dependencies ----
FROM node:26-alpine

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    APP_VERSION=$APP_VERSION

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY --from=web /web/dist ./public

# /data holds EVERYTHING the user creates (library, covers cache, backups).
# Mount a host folder or named volume here; the image itself is disposable.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# The server starts as root only to look at who owns /data, then runs as that user (or as "node", uid 1000, when Docker
# created the folder as root) BEFORE it listens on the network. So a NAS folder owned by any user just works.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.js"]
