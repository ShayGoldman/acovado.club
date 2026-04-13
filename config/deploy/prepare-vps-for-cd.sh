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

# Pipeline app env files — created as stubs if missing; operator must fill in secrets.
# See config/deploy/env-templates/ for the full list of required vars per service.

if [ ! -s /srv/env/reddit-worker.env ]; then
  cat >/srv/env/reddit-worker.env <<'EOF'
# Fill in before first deploy — see config/deploy/env-templates/reddit-worker.env
DATABASE_URL=postgresql://acovado:CHANGE_ME@postgres:5432/production
RABBITMQ_URL=amqp://acovado:CHANGE_ME@rabbitmq:5672
REDDIT_CLIENT_ID=CHANGE_ME
REDDIT_CLIENT_SECRET=CHANGE_ME
REDDIT_USER_AGENT=acovado-reddit-worker/1.0
POLL_CRON=*/15 * * * *
EOF
  chmod 600 /srv/env/reddit-worker.env
  log "Created /srv/env/reddit-worker.env stub — fill in REDDIT_CLIENT_ID/SECRET and DB/AMQP credentials"
else
  log "Left existing /srv/env/reddit-worker.env unchanged"
fi

if [ ! -s /srv/env/youtube-worker.env ]; then
  cat >/srv/env/youtube-worker.env <<'EOF'
# Fill in before first deploy — see config/deploy/env-templates/youtube-worker.env
DATABASE_URL=postgresql://acovado:CHANGE_ME@postgres:5432/production
RABBITMQ_URL=amqp://acovado:CHANGE_ME@rabbitmq:5672
YOUTUBE_FETCH_LIMIT=10
POLL_CRON=0 * * * *
EOF
  chmod 600 /srv/env/youtube-worker.env
  log "Created /srv/env/youtube-worker.env stub — fill in DB/AMQP credentials"
else
  log "Left existing /srv/env/youtube-worker.env unchanged"
fi

if [ ! -s /srv/env/signal-processor.env ]; then
  cat >/srv/env/signal-processor.env <<'EOF'
# Fill in before first deploy — see config/deploy/env-templates/signal-processor.env
DATABASE_URL=postgresql://acovado:CHANGE_ME@postgres:5432/production
RABBITMQ_URL=amqp://acovado:CHANGE_ME@rabbitmq:5672
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=gemma3:4b
PORT=3001
EOF
  chmod 600 /srv/env/signal-processor.env
  log "Created /srv/env/signal-processor.env stub — fill in DB/AMQP credentials"
else
  log "Left existing /srv/env/signal-processor.env unchanged"
fi

if [ ! -s /srv/env/dashboard.env ]; then
  cat >/srv/env/dashboard.env <<'EOF'
# Fill in before first deploy — see config/deploy/env-templates/dashboard.env
DATABASE_URL=postgresql://acovado:CHANGE_ME@postgres:5432/production
PORT=3000
EOF
  chmod 600 /srv/env/dashboard.env
  log "Created /srv/env/dashboard.env stub — fill in DB credentials"
else
  log "Left existing /srv/env/dashboard.env unchanged"
fi

log "Done. Next: fill in CHANGE_ME values in /srv/env/*.env, then merge to main so Drone builds and runs the deploy step."
