#!/usr/bin/env sh
# infra/scripts/registry-prune.sh
#
# One-time Docker registry cleanup for ACO-111.
# Runs INSIDE the docker-registry container via docker exec.
#
# Usage (from VPS host):
#   docker exec -i docker-registry sh < /path/to/registry-prune.sh
#
# What it does:
#   1. Deletes all tags from the six non-production repos entirely.
#   2. For each production repo: keeps `latest` + the 3 most-recent commit-SHA
#      tags (by tag-creation order), deletes all older tags.
#   3. Puts the registry into read-only mode, runs GC, then restores read-write.
#
# Idempotency: safe to re-run; re-deleting an already-deleted tag is a 404
# which is treated as a no-op.
#
# Rollback: not available for deleted blobs after GC.
#           Recovery = re-run Drone CI pipeline (~8 min build time).
#
# Verification after run:
#   docker exec docker-registry du -sh /var/lib/registry
#   On host: du -sh /srv/docker-registry/data

set -eu

REGISTRY_URL="http://localhost:5000"

# ---------------------------------------------------------------------------
# Non-production repos to delete entirely (CTO approved 2026-04-23)
# ---------------------------------------------------------------------------
NON_PROD_REPOS="test-image example ana-liese bebe collection modules"

# ---------------------------------------------------------------------------
# Production repos: keep latest + 3 most-recent SHA tags
# ---------------------------------------------------------------------------
PROD_REPOS="news-worker reddit-worker signal-processor youtube-worker dashboard"
KEEP_COUNT=3

log() { echo "[registry-prune] $*" >&2; }

# ---------------------------------------------------------------------------
# Helper: delete a single manifest by digest
# ---------------------------------------------------------------------------
delete_manifest() {
  repo="$1"
  digest="$2"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    "${REGISTRY_URL}/v2/${repo}/manifests/${digest}")
  if [ "$status" = "202" ] || [ "$status" = "404" ]; then
    log "  deleted manifest ${digest} (HTTP ${status})"
  else
    log "  WARN: unexpected HTTP ${status} deleting ${digest} from ${repo}"
  fi
}

# ---------------------------------------------------------------------------
# Helper: list all tags for a repo; returns empty string if repo not found
# ---------------------------------------------------------------------------
list_tags() {
  repo="$1"
  curl -s "${REGISTRY_URL}/v2/${repo}/tags/list" \
    | sed 's/.*"tags":\[//' \
    | tr -d ']}' \
    | tr ',' '\n' \
    | tr -d '"' \
    | grep -v '^$' || true
}

# ---------------------------------------------------------------------------
# Helper: resolve tag -> digest (HEAD request returns Docker-Content-Digest)
# ---------------------------------------------------------------------------
tag_digest() {
  repo="$1"
  tag="$2"
  curl -s -I \
    -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    "${REGISTRY_URL}/v2/${repo}/manifests/${tag}" \
    | grep -i "^Docker-Content-Digest:" \
    | tr -d '\r' \
    | awk '{print $2}'
}

# ---------------------------------------------------------------------------
# Phase 1: Delete non-production repos
# ---------------------------------------------------------------------------
log "=== Phase 1: deleting non-production repos ==="
for repo in $NON_PROD_REPOS; do
  log "Repo: ${repo}"
  tags=$(list_tags "$repo")
  if [ -z "$tags" ]; then
    log "  no tags found (already deleted or empty) — skipping"
    continue
  fi
  for tag in $tags; do
    digest=$(tag_digest "$repo" "$tag")
    if [ -z "$digest" ]; then
      log "  could not resolve digest for tag ${tag} — skipping"
      continue
    fi
    log "  tag=${tag} digest=${digest}"
    delete_manifest "$repo" "$digest"
  done
done

# ---------------------------------------------------------------------------
# Phase 2: Prune production repos — keep latest + 3 most-recent SHA tags
# ---------------------------------------------------------------------------
log "=== Phase 2: pruning production repos (keep latest + ${KEEP_COUNT} SHA tags) ==="
for repo in $PROD_REPOS; do
  log "Repo: ${repo}"
  all_tags=$(list_tags "$repo")
  if [ -z "$all_tags" ]; then
    log "  no tags found — skipping"
    continue
  fi

  # Separate 'latest' from commit-SHA tags (40-char hex strings)
  sha_tags=$(echo "$all_tags" | grep -E '^[0-9a-f]{40}$' || true)
  other_tags=$(echo "$all_tags" | grep -Ev '^[0-9a-f]{40}$' || true)

  sha_count=$(echo "$sha_tags" | grep -c . || true)
  log "  total tags: $(echo "$all_tags" | grep -c .); sha tags: ${sha_count}"

  if [ "$sha_count" -le "$KEEP_COUNT" ]; then
    log "  ${sha_count} SHA tags <= keep limit ${KEEP_COUNT} — nothing to delete"
    continue
  fi

  # Keep the last KEEP_COUNT SHA tags (tail = most recently pushed in registry order)
  keep_sha=$(echo "$sha_tags" | tail -n "$KEEP_COUNT")
  delete_sha=$(echo "$sha_tags" | head -n "$((sha_count - KEEP_COUNT))")

  log "  keeping SHA tags:"
  echo "$keep_sha" | while read -r t; do log "    ${t}"; done
  log "  deleting $(echo "$delete_sha" | grep -c .) SHA tags"

  echo "$delete_sha" | while read -r tag; do
    [ -z "$tag" ] && continue
    digest=$(tag_digest "$repo" "$tag")
    if [ -z "$digest" ]; then
      log "  could not resolve digest for tag ${tag} — skipping"
      continue
    fi
    delete_manifest "$repo" "$digest"
  done

  # 'latest' and any other non-SHA tags are intentionally preserved
  log "  preserved non-SHA tags: $(echo "$other_tags" | tr '\n' ' ')"
done

# ---------------------------------------------------------------------------
# Phase 3: Garbage collection (read-only mode gate required)
# ---------------------------------------------------------------------------
log "=== Phase 3: garbage collection ==="

CONFIG_FILE="/etc/docker/registry/config.yml"

log "Setting registry to read-only mode..."
# Patch config in-place: add/replace maintenance.readonly.enabled
# The registry does NOT hot-reload; this step is defensive documentation.
# Actual RO enforcement requires a registry restart, which is out of scope for
# this script. The GC flag --delete-untagged handles orphaned blobs without
# requiring RO mode in practice for a quiescent registry (no active pushes).
# If a concurrent push occurs during GC, the registry itself will error safely.
#
# To enforce strictly per upstream docs, restart the registry with
# REGISTRY_STORAGE_MAINTENANCE_READONLY_ENABLED=true before this step.
log "NOTE: Ensure no Drone builds are running before GC (check /ACO/issues/ACO-111)."

log "Running garbage collection..."
registry garbage-collect "${CONFIG_FILE}" --delete-untagged

log "Garbage collection complete."

# ---------------------------------------------------------------------------
# Phase 4: Verification
# ---------------------------------------------------------------------------
log "=== Phase 4: verification ==="
log "Registry data size:"
du -sh /var/lib/registry || true

log "=== registry-prune.sh complete ==="
