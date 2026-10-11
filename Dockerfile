# syntax=docker/dockerfile:1
#
# Production image, in stages:
#
#   deps   every dependency, for building (and the Prisma CLI)
#   build  the Next.js production build (standalone output)
#   tools  migrations and maintenance commands, run once (`docker compose
#          run --rm migrate`, guests:repurge after a restore): the Prisma CLI
#          and the scripts bundled into single files, nothing else
#          (about 0.5 GB instead of the whole build)
#   app    what runs: Next's standalone server and static files only, as the
#          unprivileged `node` user
#
# Built by scripts/deploy/deploy.sh; see docs/deployment.md.

# Exactly the version .nvmrc and .gitlab-ci.yml name. Bump all three together.
ARG NODE_VERSION=24.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
# Prisma picks its schema engine by the OpenSSL it finds when installing.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
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
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ARG SENTRY_RELEASE=""
RUN npm run build && npm run build:tools
# The photo processing (GitLab #106) must work from the standalone output
# the app stage copies: fail the image build, not the first upload.
RUN node scripts/check-standalone-sharp.mjs

# The Prisma CLI and exactly its own dependencies, as the lockfile installed
# them: copied out of the full install rather than installed again.
FROM deps AS prisma-cli
RUN npm query '#prisma, #prisma *' \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log([...new Set(JSON.parse(s).map((n)=>n.location))].join("\n")))' \
  > /tmp/prisma-cli.txt \
  && mkdir /out && tar -cf - -T /tmp/prisma-cli.txt | tar -xf - -C /out

FROM node:${NODE_VERSION}-bookworm-slim AS tools
# The schema engine needs OpenSSL at run time too.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prisma-cli /out/node_modules ./node_modules
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY docker/tools/prisma.config.ts docker/tools/package.json ./
COPY --from=build /app/dist-tools ./dist-tools
USER node
# Applies pending migrations; the compose `migrate` service runs this once
# before each deploy's app starts. The maintenance commands keep their
# names: `npm run guests:repurge -- <file>`, `npm run tokens:rotate`.
CMD ["npm", "run", "migrate:deploy"]

FROM node:${NODE_VERSION}-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Receipts (GitLab #82): the `receipts` volume is mounted here. Created as
# the app's user, so a fresh named volume starts out writable by it.
RUN mkdir -p /data/receipts && chown node:node /data/receipts
ENV RECEIPTS_DIR=/data/receipts
USER node
EXPOSE 3000
# Liveness only (/api/health): a database outage must not restart the app in
# a loop. Readiness (/api/ready) is the reverse proxy's check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
