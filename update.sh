#!/usr/bin/env bash
# update.sh — pull latest code and redeploy Francine via Docker Compose
#
# Usage:
#   chmod +x update.sh
#   ./update.sh           # pull + rebuild + restart
#   ./update.sh --no-pull # skip git pull (rebuild from local working tree)

set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
NO_PULL=false

for arg in "$@"; do
  [[ "$arg" == "--no-pull" ]] && NO_PULL=true
done

echo "==> Francine update — $(date '+%Y-%m-%d %H:%M:%S')"

if [[ "$NO_PULL" == false ]]; then
  echo "==> Pulling latest changes..."
  git -C "$(dirname "$0")" pull --ff-only
fi

echo "==> Building new image..."
docker compose -f "$COMPOSE_FILE" build --pull

echo "==> Restarting container (zero-downtime swap)..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

echo "==> Waiting for health check..."
for i in $(seq 1 18); do
  if docker exec francine node -e "require('http').get('http://localhost:3002/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; then
    echo "==> Container is healthy."
    break
  fi
  if [[ "$i" -eq 18 ]]; then
    echo "ERROR: Container did not become healthy within 90 s." >&2
    echo "       Check logs with: docker compose logs --tail=50 francine" >&2
    exit 1
  fi
  echo "    ($i/18) not ready — retrying in 5 s..."
  sleep 5
done

echo "==> Pruning dangling images..."
docker image prune -f --filter "label=com.docker.compose.project=francine" 2>/dev/null || true

echo "==> Done. Francine is running at $(grep -m1 AUTH_URL "$COMPOSE_FILE" | awk '{print $2}')"
