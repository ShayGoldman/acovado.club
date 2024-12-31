# Base Bun image
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM oven/bun:1-alpine AS base-alpine
WORKDIR /usr/src/app

# Stage 1: Install dependencies
FROM base AS dependencies
COPY . ./
RUN bun install --frozen-lockfile

# Stage 2: Build shared modules
FROM base-alpine AS modules-builder
COPY --from=dependencies /usr/src/app ./
WORKDIR /usr/src/app
RUN bunx turbo build --filter="@modules/*"

# Stage 3: Build each app
FROM base AS app-builder
ARG APP_NAME
COPY --from=modules-builder /usr/src/app ./
WORKDIR /usr/src/app
RUN bunx turbo build --filter="$APP_NAME"

# Stage 4: Production image
FROM base-alpine AS production
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=dependencies /usr/src/app ./
COPY --from=modules-builder /usr/src/app/modules ./modules
COPY --from=app-builder /usr/src/app/apps/$APP_PATH ./apps/$APP_PATH
WORKDIR /usr/src/app/apps/$APP_PATH
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "lib/index.js"]
