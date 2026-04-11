# Workspace packages under modules/ stay as TypeScript sources; Bun resolves them at runtime (JIT).
# Apps import them via workspace protocol, e.g. import { makeLogger } from '@modules/logger';
FROM oven/bun:1-alpine AS dependencies
WORKDIR /usr/src/app
COPY . ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1-alpine AS production
WORKDIR /usr/src/app
ARG APP_PATH
COPY --from=dependencies /usr/src/app ./
WORKDIR /usr/src/app/apps/${APP_PATH}
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
