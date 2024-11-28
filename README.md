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

Run everything locally by following these instructions:

1. `@repo`: `bun turbo run start --filter="@infra/*"`
2. `@repo`: `bun turbo run dev --filter="@modules/*"`
3. `repo`: `bun turbo run dev --filter="@apps/%whatever%"`

## Tasks

[ ] Producing messages should be done one-by-one
[ ] Allow attaching to apps for debbuging
[ ] Add Drizzle eslint plugin (https://orm.drizzle.team/docs/eslint-plugin)
[ ] Running production mode with docker compose
