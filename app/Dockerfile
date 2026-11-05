# syntax=docker/dockerfile:1

# The web image. Build context is the REPO ROOT (RedRun gitSource.baseDirectory
# "/", dockerfilePath "Dockerfile"), because `web` imports workspace packages
# and RedRun tars only the base directory as the build context.
#
# Adapted from redBuild's Dockerfile: same stage layout, same npmrc-secret
# discipline. The RedRun worker rewrites this file, inserting `ARG K` and
# `ENV K=${K}` after every `FROM` line for each build-safe env key.

FROM node:24-alpine AS base
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
# Every workspace package.json, so the installer can build the workspace graph
# without the sources. A new workspace means a new COPY line here.
# NOTE: package-lock.json is deliberately NOT copied: v0 has no committed
# lockfile (it needs one authenticated `npm install` against
# registry.redbtn.io to generate). When it exists, add it to this COPY line
# and the `npm ci` branch below takes over.
COPY package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/redlabel/package.json packages/redlabel/
COPY web/package.json web/
# NODE_ENV is deliberately NOT production here: `npm ci` must install
# devDependencies for `next build`. Setting it in appConfig.env leaks into the
# build and breaks it.
#
# The committed .npmrc carries no credential. RedRun injects the global NPMRC
# redsecret as BuildKit secret id "npmrc"; the mount shadows /app/.npmrc for the
# duration of this RUN only and never lands in a layer or in docker history.
# _BUILD_SECRET_NPMRC is the fallback for a non-BuildKit builder.
ARG _BUILD_SECRET_NPMRC
RUN --mount=type=secret,id=npmrc,target=/tmp/npmrc-secret \
    if [ -s /tmp/npmrc-secret ]; then \
      cp /tmp/npmrc-secret .npmrc; \
    elif [ -n "$_BUILD_SECRET_NPMRC" ]; then \
      printf '%s' "$_BUILD_SECRET_NPMRC" > .npmrc; \
    fi && \
    if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts --no-audit --no-fund; \
    else \
      npm install --ignore-scripts --no-audit --no-fund; \
    fi && \
    printf '@redbtn:registry=https://registry.redbtn.io/\n' > .npmrc

# ---------- builder ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The redbtn logo PNG is binary; the workspace push is text-only, so it
# travels base64-encoded and is materialized before the build.
RUN node web/scripts/write-logo.mjs
RUN npm run build -w web

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# `output: standalone` does not carry public/, and git does not track empty
# directories, so web/public must contain at least one committed file.
COPY --from=builder /app/web/public ./web/public
# The standalone output MIRRORS the monorepo, hence the web/ prefixes and the
# entrypoint below.
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "web/server.js"]
