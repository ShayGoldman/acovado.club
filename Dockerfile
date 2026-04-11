# Workspace packages under modules/ stay TypeScript sources (no per-package dist).
# The app `bun build` compiles the entrypoint and inlines workspace imports into apps/<name>/dist/.
# Apps import via workspace protocol, e.g. import { makeLogger } from '@modules/logger';
FROM oven/bun:1-alpine AS dependencies
WORKDIR /usr/src/app
COPY . ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1-alpine AS app-builder
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=dependencies /usr/src/app ./
WORKDIR /usr/src/app/apps/${APP_PATH}
RUN bun run build

FROM oven/bun:1-alpine AS production
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=app-builder /usr/src/app/apps/${APP_PATH}/dist ./dist
COPY --from=app-builder /usr/src/app/node_modules ./node_modules
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
