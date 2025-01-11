# acovado.club

![Build Status](https://ci.acovado.club/api/badges/ShayGoldman/acovado.club/status.svg?ref=refs/heads/main)

## Local Development

Run everything locally by following these instructions from the root of the project:

1. `bunx turbo start --filter="@infra/*"`
2. `bunx turbo dev --filter="@modules/*"`
3. `bunx turbo dev --filter="@clients/*"`
4. `bunx turbo dev --filter="@apps/*"`

## Debugging

It won't be the easiest to debug locally, but each of the apps has a `debug` script that will start the app with the `--inspect` flag.
You can then attach to the process using the VSCode debugger.

## Tasks

[ ] Use Docker cache for builds
[ ] Daily Docker cleanup
[ ] Add turbo prune with cache between each build (https://turbo.build/repo/docs/guides/tools/docker)
[ ] Add prometheus metrics everywhere
[ ] Add tracing to proxy everywhere
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

# Drizzle studio theme

https://drizzle.studio/themes/elKOzCWRB2NDOTHL8_f8C/edit?token=0ad6fab842e81f61d5f2d2679526e7a3823b96b4
