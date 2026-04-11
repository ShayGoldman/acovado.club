# SigNoz Observability Infrastructure

This directory contains the configuration for the SigNoz observability platform, which provides distributed tracing, metrics, and logs for the acovado.club application.

This repository **standardizes on SigNoz only** for that telemetry. Do not run a separate Grafana, Tempo, Loki, or standalone Prometheus stack for application observability alongside this.

**In Docker (apps + collector on the same network):** set `TRACE_EXPORTER_URLS=http://otel-collector:4318/v1/traces` (see `config/compose/docker-compose.apps.yaml` and app env files). The hostname `otel-collector` resolves on `internal-network`.

**On the host** (e.g. `process-compose` or `bun run dev`): use `http://localhost:4318/v1/traces` — **`infra/observability/docker-compose.yaml`** maps the collector’s OTLP ports **4317** (gRPC) and **4318** (HTTP) to the same ports on localhost. Alternatively, keep `http://otel-collector:4318/v1/traces` and add `127.0.0.1 otel-collector` to `/etc/hosts`.

**Prometheus:** Application metrics should be sent with **OTLP** to the collector (`4317` / `4318`). The collector also runs an embedded **Prometheus scrape** of its own metrics (`otel-collector-signoz-config.yaml`, `receivers.prometheus` → `localhost:8888`). Do not run a separate Prometheus server for app telemetry; SigNoz stores metrics in ClickHouse. The file `signoz/prometheus.yml` is for SigNoz’s internal Prometheus wiring, not for scraping your apps directly.

**Retention** (e.g. 30 days for traces, metrics, and logs) is configured in the SigNoz UI under **Settings → General**. SigNoz applies the corresponding ClickHouse TTL; see the [retention docs](https://signoz.io/docs/userguide/retention-period/).

**Container log rotation** on the host uses Docker `json-file` limits (`max-size` / `max-file`) from `config/compose/docker-compose.*.yaml` and `infra/observability/docker-compose*.yaml` so service stdout does not fill disk.

## Overview

SigNoz is a self-hosted, open-source observability platform that provides:
- **Distributed Tracing**: Track requests across microservices
- **Metrics**: Monitor application and system metrics
- **Logs**: Centralized log aggregation and analysis
- **APM (Application Performance Monitoring)**: Automatic service maps and performance insights

## Architecture

The setup consists of the following components:

### Core Services

1. **SigNoz UI & Backend** (`signoz`)
   - Container: `signoz`
   - Image: `signoz/signoz:v0.105.1`
   - Port: `8080` (UI and API)
   - Purpose: Main application providing the UI, alerting, and query service

2. **OpenTelemetry Collector** (`otel-collector`)
   - Container: `signoz-otel-collector`
   - Image: `signoz/signoz-otel-collector:v0.129.12`
   - Ports (published to the host in `docker-compose.yaml` as `4317` / `4318`):
     - `4317`: OTLP gRPC receiver
     - `4318`: OTLP HTTP receiver
   - Purpose: Receives, processes, and exports telemetry data (traces, metrics, logs)

3. **ClickHouse** (`clickhouse`)
   - Container: `signoz-clickhouse`
   - Image: `clickhouse/clickhouse-server:25.5.6`
   - Port: `9000` (internal)
   - Purpose: Time-series database for storing traces, metrics, and logs

4. **ZooKeeper** (`zookeeper-1`)
   - Container: `signoz-zookeeper-1`
   - Image: `bitnami/zookeeper:3.7.1`
   - Purpose: Distributed coordination for ClickHouse cluster

5. **Schema Migrators**
   - `schema-migrator-sync`: Synchronous schema migrations
   - `schema-migrator-async`: Asynchronous schema migrations
   - Image: `signoz/signoz-schema-migrator:v0.129.12`
   - Purpose: Manage ClickHouse database schema updates

## Configuration Files

### Docker Compose
- **`docker-compose.yaml`**: Main compose file with full service definitions, volumes, and port mappings
- **`docker-compose.base.yaml`**: Base templates for ClickHouse and ZooKeeper with shared defaults

### OpenTelemetry Collector
- **`otel-collector-signoz-config.yaml`**: Main OTLP collector configuration
  - Receivers: OTLP (gRPC/HTTP), Prometheus
  - Processors: Batch processing, resource detection, span metrics generation
  - Exporters: ClickHouse exporters for traces, metrics, and logs
  - Pipelines: Separate pipelines for traces, metrics, and logs

### SigNoz
- **`signoz/prometheus.yml`**: Prometheus configuration for SigNoz backend
- **`signoz/otel-collector-opamp-config.yaml`**: OpAMP (Open Agent Management Protocol) configuration for remote collector management

### ClickHouse
- **`clickhouse/config.xml`**: Main ClickHouse server configuration
- **`clickhouse/users.xml`**: User authentication and authorization settings
- **`clickhouse/cluster.xml`**: Cluster topology configuration
- **`clickhouse/custom-function.xml`**: Custom SQL functions for SigNoz

## Data Storage

The following Docker volumes are used for persistent data:

- `signoz-clickhouse`: ClickHouse database files
- `signoz-sqlite`: SigNoz metadata and configuration
- `signoz-zookeeper-1`: ZooKeeper data

## Getting Started

### Starting the Stack

```bash
# From the infra/observability directory
docker compose up -d
```

### Stopping the Stack

```bash
docker compose down
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f signoz
docker compose logs -f otel-collector
docker compose logs -f clickhouse
```

## Accessing SigNoz

Once the services are running, access the SigNoz UI at:

**http://localhost:8080**

The first time you access it, you'll be prompted to create an admin account.

## Sending Telemetry Data

Applications can send telemetry data to the OpenTelemetry Collector using:

### OTLP gRPC
- Endpoint from the host: `localhost:4317`
- Use for: Most production applications (better performance)

### OTLP HTTP
- Endpoint from the host: `http://localhost:4318`
- Use for: Browser applications or when gRPC is not available

### Example (raw OpenTelemetry SDK)

This monorepo normally uses **`@modules/tracing`** (`makeTracer`) instead of wiring exporters by hand. If you integrate another language or a raw Node SDK, send OTLP to **`http://localhost:4318/v1/traces`** (HTTP) or gRPC on **`localhost:4317`**, matching the collector receivers above.

## Data Flow

```
Application
    ↓
    ↓ (OTLP gRPC/HTTP)
    ↓
OpenTelemetry Collector
    ↓
    ↓ (Process & Export)
    ↓
ClickHouse Database
    ↓
    ↓ (Query)
    ↓
SigNoz UI & Backend
```

## Key Features Enabled

### Trace Processing
- **Span Metrics Generation**: Automatically generates RED (Rate, Error, Duration) metrics from traces
- **Exponential Histograms**: Enabled for better latency distribution analysis
- **Low Cardinal Exception Grouping**: Controlled via `LOW_CARDINAL_EXCEPTION_GROUPING` environment variable

### Metrics Collection
- **OTLP Metrics**: Direct ingestion from applications
- **Prometheus Metrics**: Scraping from Prometheus-compatible endpoints
- **Internal Monitoring**: The collector exposes its own metrics on port 8888

### Resource Detection
- Automatic detection of host and system attributes
- Custom resource attributes via `OTEL_RESOURCE_ATTRIBUTES` environment variable

## Health Checks

All services include health checks:

- **SigNoz**: `http://localhost:8080/api/v1/health`
- **ClickHouse**: HTTP ping on port 8123
- **ZooKeeper**: Administrative endpoint on port 8080
- **OTLP Collector**: Health check extension on port 13133

## Troubleshooting

### Check Service Health

```bash
# Check all services status
docker compose ps

# Check specific service health
docker compose exec signoz wget -qO- http://localhost:8080/api/v1/health
```

### Common Issues

1. **Services not starting**: Check logs with `docker compose logs [service-name]`
2. **Data not appearing in UI**: Verify OTLP collector is receiving data (check logs)
3. **ClickHouse connection errors**: Ensure ClickHouse is healthy before other services start
4. **Out of memory**: Increase Docker memory allocation (ClickHouse is memory-intensive)

### Resetting the Environment

To completely reset all data:

```bash
docker compose down -v  # Warning: This deletes all volumes and data
docker compose up -d
```

## Version Information

- **SigNoz**: v0.105.1
- **OpenTelemetry Collector**: v0.129.12
- **ClickHouse**: 25.5.6
- **ZooKeeper**: 3.7.1

## Additional Resources

- [SigNoz Documentation](https://signoz.io/docs/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [ClickHouse Documentation](https://clickhouse.com/docs/)

## Deployment Type

This is configured as a **docker-standalone** deployment, suitable for development and small-to-medium production workloads. For high-availability production deployments, consider:
- Multiple ClickHouse replicas
- Multiple ZooKeeper instances for quorum
- Load-balanced OTLP collectors
- External storage solutions

## Monitoring the Stack

The OTLP Collector exposes Prometheus metrics on port 8888, which can be scraped to monitor the collector itself:

```yaml
scrape_configs:
  - job_name: otel-collector
    static_configs:
      - targets: ['localhost:8888']
```

Additionally, the collector includes a pprof endpoint on port 1777 for performance profiling.

