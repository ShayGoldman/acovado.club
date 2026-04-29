# ACO-126: VPS Disk Cleanup Runbook

**Branch:** `aco-126-vps-disk-cleanup`  
**Status:** Awaiting Principal + CTO sign-off, then board approval before execution.

## Inventory (taken 2026-04-29)

| Path | Size |
|------|------|
| Root filesystem (`/`) | 86G used / 96G total (90%) |
| `/var/lib/docker/overlay2` | ~29G |
| `/var/lib/docker/containers` (log files) | 1.4G |
| `/var/lib/docker/image` | 49M |
| `/var/lib/docker/volumes` | ~20M |
| `/var/log` | 454M |

**Top container log consumers:**

| Container | Log size |
|-----------|----------|
| docker-registry | 100M |
| oauth2-proxy | 95M |
| signal-processor | 72M (inflated by ACO-125 401 retry loop) |
| signoz-otel-collector | 29M |
| signoz-clickhouse | 24M |
| traefik (proxy) | 21M |

**Stopped containers (safe to prune):**
- `drone-YSEGXyUyEeL5QbeQQsaX` (Exited CI pipeline run)
- `drone-ZIPmgaZG4ejyJP5ulghi` (Exited CI pipeline run)
- `drone-zPUzRY1M8ImLTzHtLGcd` (Exited CI pipeline run)
- `drone-JpqYawbtzxHXFGIK2bo8` (Exited CI pipeline run)
- `signoz-telemetrystore-migrator` (Exited one-off migrator)

All images are in use by at least one running or active container — no image prune planned.

## Plan

### Step 1 — Truncate container log files (no approval needed, no downtime)

Truncate the six largest log files in-place. This does not restart or impact any container — Docker continues writing to the same file handle, so no log entries are lost going forward.

```sh
truncate -s 0 /var/lib/docker/containers/dc73ff0786c83015bd61617dbb63849a0e4c6cf3031f31f1de1f01757ba98ac5/dc73ff0786c83015bd61617dbb63849a0e4c6cf3031f31f1de1f01757ba98ac5-json.log
truncate -s 0 /var/lib/docker/containers/a0d3612067287d926ae25e9665881c55bd9d9e080a7ba88c9a637f7ccf77089f/a0d3612067287d926ae25e9665881c55bd9d9e080a7ba88c9a637f7ccf77089f-json.log
truncate -s 0 /var/lib/docker/containers/8df33452dba63f4df074fffa217e2687050d353aab8cb4a66534110c47ea2b98/8df33452dba63f4df074fffa217e2687050d353aab8cb4a66534110c47ea2b98-json.log
truncate -s 0 /var/lib/docker/containers/7a49fda3a77870385964a5931a162218370b1f3d00ea2fecc7549ba36bd64ac4/7a49fda3a77870385964a5931a162218370b1f3d00ea2fecc7549ba36bd64ac4-json.log
truncate -s 0 /var/lib/docker/containers/2c49df5f9475aa2793b01432aca8b148e018a5a8a245f2c5617b8d235aae44f3/2c49df5f9475aa2793b01432aca8b148e018a5a8a245f2c5617b8d235aae44f3-json.log
truncate -s 0 /var/lib/docker/containers/6c299bd2b6a761459b2ac9b459a1a850673f4809328c839189451c921aed6441/6c299bd2b6a761459b2ac9b459a1a850673f4809328c839189451c921aed6441-json.log
```

Expected reclaim: ~341M.

### Step 2 — Remove stopped CI pipeline containers (board approval required)

```sh
docker container prune -f --filter "label=io.drone.step.name"
```

Or explicitly by name if the label filter does not match:
```sh
docker rm drone-YSEGXyUyEeL5QbeQQsaX drone-ZIPmgaZG4ejyJP5ulghi drone-zPUzRY1M8ImLTzHtLGcd drone-JpqYawbtzxHXFGIK2bo8 signoz-telemetrystore-migrator
```

Expected reclaim: negligible (write layers are <5MB total), but cleans state.

### Step 3 — Clear Docker build cache (board approval required)

```sh
docker builder prune -f
```

This is the same command requested in ACO-121 (approval `8c596252`). If that approval has cleared, execute this in the same step. Expected reclaim: unknown but likely several GB from overlay2.

### Step 4 — Add Docker log rotation (board approval required)

Add log rotation to prevent recurrence. Edit `/etc/docker/daemon.json`:

```json
{
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
```

Then restart the Docker daemon:
```sh
systemctl restart docker
```

**WARNING:** `systemctl restart docker` stops and restarts all containers. Expected downtime: 30–60 seconds for all services. SigNoz stack will restart including `signoz-zookeeper` (currently unhealthy per ACO-110) — this may change its state. Verify post-restart carefully.

Log rotation only applies to containers created after the daemon config change. Existing containers need to be restarted to pick it up (which the daemon restart handles).

## Rollback

| Step | Rollback |
|------|----------|
| Step 1 (log truncation) | Not reversible. Historical logs gone but no service impact. |
| Step 2 (container prune) | Not reversible. Containers were already exited — no service impact. |
| Step 3 (builder prune) | Not reversible. Build cache regenerated on next `bun build` / CI run. |
| Step 4 (daemon.json + restart) | Remove the `log-opts` block from `/etc/docker/daemon.json`, then `systemctl restart docker` again. This re-restarts all containers — same 30–60s downtime. |

## Verification

After each step, run:
```sh
df -h /
du -sh /var/lib/docker/containers /var/lib/docker/overlay2
docker ps
```

After Step 4 (daemon restart):
```sh
docker ps  # all expected containers running
docker inspect --format='{{.Name}} {{.HostConfig.LogConfig.Config}}' $(docker ps -q) | head -10  # confirm log-opts applied
```

Check SigNoz specifically:
```sh
docker inspect signoz-zookeeper --format '{{.State.Health.Status}}'
```

Note: `signoz-zookeeper` is expected to remain unhealthy (ACO-110). If it transitions to a new failure mode post-restart, escalate to CTO.

## Interaction with other incidents

- **ACO-125** (Anthropic key invalid): once resolved, signal-processor log will naturally shrink (401 retry loop stops). Step 1 still useful to clear the existing 72M immediately.
- **ACO-110** (SigNoz/ZooKeeper): Step 4 will restart the entire SigNoz stack. Coordinate with CTO before executing Step 4 if ACO-110 is mid-remediation.
- **ACO-121** (docker builder prune, approval `8c596252`): Step 3 covers the same action — can execute under that approval if it clears first.
