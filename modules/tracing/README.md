# @modules/tracing

## SigNoz log export (module-owned)

- `makeTracer` now also wires an OTLP log pipeline inside the module. Apps keep calling `makeTracer` as before; no app-level exporter setup is required.
- Logs are exported over OTLP/HTTP using the same `exporterUrls` passed to `makeTracer` unless you override with `logExporterUrls`.
- Log export is on by default; set `logExportEnabled: false` when constructing the tracer to disable.
- Each log record is linked to the active span (trace/span ids added as attributes) and still goes through `@modules/logger` for local output.

### Typical SigNoz collector settings

- Point `exporterUrls` (or `logExporterUrls`) to your SigNoz collector OTLP HTTP endpoint, e.g. `http://localhost:4318/v1/logs` and `http://localhost:4318/v1/traces`.
- If your collector needs auth/tenant headers, pass them via the collector config; the OTLP exporters here use plain URL configuration.

### Usage snippet

```ts
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({ name: 'reddit-processor' });

const tracer = makeTracer({
  serviceName: 'reddit-processor',
  exporterUrls: [process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces'],
  // Optional overrides
  // logExporterUrls: ['http://localhost:4318/v1/logs'],
  // logExportEnabled: true,
  logger,
});
```

