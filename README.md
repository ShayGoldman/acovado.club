# Finance

## Local Development

### Option 1:

Use docker-compose to run the local development environment using the following command:

```bash
docker compose -f docker-compose.yaml \
               -f infra/postgres/docker-compose.yaml \
               -f apps/collection/docker-compose.yaml \
               -f apps/bebe/docker-compose.yaml \
                up
```

### Option 2:

Use option 1 with Dev containers (IDE plugin)

### Option 3:

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo start --filter="@infra/*"`
2. `bunx turbo dev --filter="@modules/*"`
3. `bunx turbo dev --filter="@clients/*"`
4. `bunx turbo dev --filter="@apps/*"`

## Tasks

[ ] Add healthz endpoint for all services + production docker-compose
[ ] Solve number handling (no floating points! and Number)
[ ] Support silent mode for simulation to avoid spamming the console with producer messages
[ ] Support `detached` mode for `tracer.with` to not always attach to the active context
[ ] Producing messages should be done one-by-one
[ ] Allow attaching to apps for debbuging
[ ] Add some span events for producer & consumer, consider creating another span for the handler itself
[ ] Start throwing coded errors and make up a strategy for handling them
[ ] Actually set a `correlationId` on messages and propagate it
[ ] Support pre & post migration scripts (db) => Promise<void>
[ ] Add Drizzle eslint plugin (https://orm.drizzle.team/docs/eslint-plugin)
[ ] Running production mode with docker compose

# Drizzle studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
