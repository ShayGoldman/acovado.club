# Base Bun image
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Stage 1: Install dependencies
FROM base AS dependencies
COPY package.json bun.lockb config ./
RUN bun install --frozen-lockfile
COPY . ./

# Stage 2: Build shared modules
FROM base AS modules
COPY --from=dependencies /usr/src/app ./
WORKDIR /usr/src/app/modules
RUN bun run build

# Stage 3: Build each app
FROM base AS app-builder
ARG APP_PATH
COPY --from=modules /usr/src/app ./
WORKDIR /usr/src/app/apps/$APP_PATH
RUN bun run build

# Stage 4: Production image
FROM base AS production
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=dependencies /usr/src/app ./
COPY --from=modules /usr/src/app/modules ./modules
COPY --from=app-builder /usr/src/app/apps/$APP_PATH ./apps/$APP_PATH
WORKDIR /usr/src/app/apps/$APP_PATH
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "lib/index.js"]
