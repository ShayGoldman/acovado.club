# Base Bun image
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Stage 1: Install dependencies (including workspace dependencies)
FROM base AS dependencies
COPY . ./
WORKDIR /usr/src/app
RUN bun install --frozen-lockfile

# Stage 2: Build the application (for production)
FROM base AS build
COPY --from=dependencies /usr/src/app ./
WORKDIR /usr/src/app
ENV NODE_ENV=production
RUN bun run build

# Stage 3: Production runtime
FROM base AS production
WORKDIR /usr/src/app
COPY --from=dependencies /usr/src/app ./
COPY --from=build /usr/src/app/lib ./lib
ENV NODE_ENV=production
USER bun
EXPOSE 3000/tcp
CMD ["bun", "run", "lib/index.js"]

# Stage 4: Development runtime
FROM base AS development
WORKDIR /usr/src/app
COPY --from=dependencies /usr/src/app ./
EXPOSE 3000/tcp
CMD ["bun", "dev"]
