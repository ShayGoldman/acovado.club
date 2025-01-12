# Tasks

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
