# Workspace packages under modules/ stay TypeScript sources (no per-package dist).
# The app `bun build` compiles the entrypoint and inlines workspace imports into apps/<name>/dist/.
# Apps import via workspace protocol, e.g. import { makeLogger } from '@modules/logger';
#
# BASE_IMAGE defaults to the alpine Bun image used by every existing worker. Apps
# that need Playwright (e.g. news-worker) override BASE_IMAGE=oven/bun:1 (Debian)
# because Playwright's bundled Chromium is built against glibc.
ARG BASE_IMAGE=oven/bun:1-alpine

FROM ${BASE_IMAGE} AS dependencies
WORKDIR /usr/src/app
COPY . ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM ${BASE_IMAGE} AS app-builder
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=dependencies /usr/src/app ./
RUN test -f ./modules/db/src/migrations/meta/_journal.json || \
    (echo "ERROR: migrations/_journal.json missing from build context — check COPY or .dockerignore" >&2 && exit 1)
WORKDIR /usr/src/app/apps/${APP_PATH}
RUN bun run build

FROM ${BASE_IMAGE} AS production
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=app-builder /usr/src/app/apps/${APP_PATH}/dist ./dist
# Pull node_modules from the dependencies stage, not app-builder — same data,
# one fewer large cross-stage transfer (app-builder never mutates node_modules).
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=app-builder /usr/src/app/modules/db/src/migrations ./modules/db/src/migrations
ENV NODE_ENV=production
ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA

# Optional Playwright browser install. Empty by default — the conditional is a
# no-op for every existing app (byte-identical images). News-worker passes
# PLAYWRIGHT_BROWSERS=chromium to opt in.
ARG PLAYWRIGHT_BROWSERS=""
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/src/app/.playwright
USER root
RUN if [ -n "$PLAYWRIGHT_BROWSERS" ]; then \
      bunx playwright install --with-deps $PLAYWRIGHT_BROWSERS && \
      chown -R bun:bun "$PLAYWRIGHT_BROWSERS_PATH"; \
    fi
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
