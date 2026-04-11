#!/usr/bin/env bash
# Run on the production host (as root) once before the first successful Drone deploy
# after aligning the repo (Signoz, example app, etc.). Idempotent where safe.
#
# Prerequisites: Docker, external networks used by Traefik (proxy-network), /srv/env, /srv/volumes.
#
# What it does:
# - Ensures internal-network + proxy-network exist
# - Creates volume mount directories under /srv/volumes
# - Stops/removes legacy containers that are NOT in config/compose (Metabase, Tempo, old OTLP collector)
# - Removes postgres/stats containers so docker compose can own them (data under /srv/volumes is kept)
# - Ensures required env files exist (does not overwrite non-empty postgres.env)

set -euo pipefail

log() {
  printf '%s\n' "$*"
}

docker network inspect internal-network >/dev/null 2>&1 || docker network create internal-network
docker network inspect proxy-network >/dev/null 2>&1 || docker network create proxy-network

mkdir -p /srv/volumes/deployment
mkdir -p /srv/volumes/signoz-zookeeper
mkdir -p /srv/volumes/signoz-clickhouse
mkdir -p /srv/volumes/signoz-sqlite
mkdir -p /srv/volumes/falkordb-data

mkdir -p /srv/env

stop_rm() {
  local c="$1"
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    docker stop "$c" >/dev/null 2>&1 || true
    docker rm "$c" >/dev/null 2>&1 || true
    log "Removed container: $c"
  fi
}

for legacy in metabase metabase-db tempo otel-collector; do
  stop_rm "$legacy"
done

if docker ps -a --format '{{.Names}}' | grep -qx postgres; then
  docker stop postgres >/dev/null
  docker rm postgres >/dev/null
  log "Removed container: postgres (data kept in /srv/volumes/postgres-data)"
fi

if docker ps -a --format '{{.Names}}' | grep -qx stats; then
  docker stop stats >/dev/null
  docker rm stats >/dev/null
  log "Removed container: stats (Portainer; will be recreated by compose)"
fi

umask 077
if [ ! -s /srv/env/postgres.env ]; then
  cat >/srv/env/postgres.env <<'EOF'
POSTGRES_USER=development
POSTGRES_PASSWORD=development
EOF
  chmod 600 /srv/env/postgres.env
  log "Created /srv/env/postgres.env (default dev credentials — change for production)"
fi

if [ ! -s /srv/env/rabbitmq.env ]; then
  cat >/srv/env/rabbitmq.env <<EOF
RABBITMQ_DEFAULT_USER=rabbit
RABBITMQ_DEFAULT_PASS=$(openssl rand -hex 16)
EOF
  chmod 600 /srv/env/rabbitmq.env
  log "Created /srv/env/rabbitmq.env with random password"
fi

if [ ! -s /srv/env/falkordb.env ]; then
  echo "FALKORDB_PASSWORD=$(openssl rand -hex 24)" >/srv/env/falkordb.env
  chmod 600 /srv/env/falkordb.env
  log "Created /srv/env/falkordb.env with random password"
fi

umask 022
if [ ! -s /srv/env/example.env ]; then
  cat >/srv/env/example.env <<'EOF'
NODE_ENV=production
PORT=3000
TRACE_EXPORTER_URLS=http://otel-collector:4318/v1/traces
EOF
  chmod 644 /srv/env/example.env
  log "Created /srv/env/example.env"
else
  log "Left existing /srv/env/example.env unchanged"
fi

log "Done. Next: merge to main so Drone builds and runs the deploy step."
