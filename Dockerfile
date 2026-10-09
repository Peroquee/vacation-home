# syntax=docker/dockerfile:1
#
# Production image, in stages:
#
#   deps   every dependency, for building (and the Prisma CLI)
#   build  the Next.js production build (standalone output)
#   tools  build + source: migrations and maintenance commands, run once
#          (`docker compose run --rm migrate`, guests:repurge after a restore)
#   app    what runs: Next's standalone server and static files only, as the
#          unprivileged `node` user
#
# Built by scripts/deploy/deploy.sh; see docs/deployment.md.

# Exactly the version .nvmrc and .gitlab-ci.yml name. Bump all three together.
ARG NODE_VERSION=24.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
# The schema and its config are needed by `npm ci`'s postinstall (prisma generate).
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Inlined into the browser bundles when building, so they are build arguments
# rather than runtime settings (see .env.example).
ARG NEXT_PUBLIC_APP_LOCALE=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ARG SENTRY_RELEASE=""
RUN npm run build

FROM build AS tools
USER node
# Applies pending migrations; the compose `migrate` service runs this once
# before each deploy's app starts.
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION}-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# Liveness only (/api/health): a database outage must not restart the app in
# a loop. Readiness (/api/ready) is the reverse proxy's check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
