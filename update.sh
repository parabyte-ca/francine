#!/usr/bin/env bash
# update.sh — safely upgrade Francine running under Docker Compose.
#
# Usage:
#   ./update.sh                    pull the latest code, back up, trial-start, restart
#   ./update.sh --pull             also refresh the Node base image while building
#   ./update.sh --version 1.2.3    move to release v1.2.3 (fast-forward only)
#   ./update.sh --no-git           build the working tree as it is (old name: --no-pull)
#   ./update.sh --skip-preflight   skip the trial start of the new version
#   ./update.sh --rollback-rev REV go back to an earlier commit
#
# Flow: fetch the source → keep what's needed to roll back → back up the
# Google Sheet → build → trial-start the new image in a throwaway container →
# restart → health check. If anything fails before the restart, nothing
# changes. If the restarted app isn't healthy, the previous image and code go
# back and are health-checked.
#
# Exit codes: 0 upgraded; 1 failed and the previous version is still (or
# again) running; 2 failed and the rollback didn't come back healthy.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

IMAGE="francine-crm"
CONTAINER="francine"
PREFLIGHT_CONTAINER="francine-preflight"
ENV_FILE="$APP_DIR/.env.local"
STATE_DIR="$APP_DIR/.update"
BACKUP_DIR="$APP_DIR/backups"
KEEP_BACKUPS=10
APP_UID=1001 # the nextjs user in the Dockerfile
APP_GID=1001
HEALTH_TRIES=18
HEALTH_DELAY=5
SEMVER_RE='^v?(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
COMPOSE=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml")
export GIT_TERMINAL_PROMPT=0

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

PULL=false
NO_GIT=false
SKIP_PREFLIGHT=false
TARGET_VERSION="${FRANCINE_UPDATE_TARGET_VERSION:-}"
ROLLBACK_REV=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) PULL=true ;;
    --no-git | --no-pull) NO_GIT=true ;;
    --skip-preflight) SKIP_PREFLIGHT=true ;;
    --version)
      [[ $# -ge 2 ]] || fail "--version needs a value, for example --version 1.2.3"
      TARGET_VERSION="$2"
      shift
      ;;
    --version=*) TARGET_VERSION="${1#*=}" ;;
    --rollback-rev)
      [[ $# -ge 2 ]] || fail "--rollback-rev needs a commit or tag"
      ROLLBACK_REV="$2"
      shift
      ;;
    --rollback-rev=*) ROLLBACK_REV="${1#*=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $1 (see ./update.sh --help)" ;;
  esac
  shift
done

if [[ -n "$TARGET_VERSION" ]]; then
  [[ "$TARGET_VERSION" =~ $SEMVER_RE ]] || fail "--version must look like 1.2.3"
  TARGET_VERSION="${TARGET_VERSION#v}"
fi
if [[ -n "$ROLLBACK_REV" ]]; then
  [[ "$ROLLBACK_REV" =~ ^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$ ]] || fail "--rollback-rev doesn't look like a commit or tag"
  [[ -z "$TARGET_VERSION" ]] || fail "Use either --version or --rollback-rev, not both."
fi
if [[ "$NO_GIT" == true && -z "${FRANCINE_UPDATE_REEXEC:-}" && (-n "$TARGET_VERSION" || -n "$ROLLBACK_REV") ]]; then
  fail "--no-git can't be combined with --version or --rollback-rev."
fi

# One update at a time. A re-exec of a newer update.sh inherits the lock.
if [[ "${FRANCINE_UPDATE_LOCKED:-}" != 1 ]]; then
  exec 8>"$APP_DIR/.update.lock"
  flock -n 8 || fail "Another update is already running."
fi

command -v docker >/dev/null || fail "docker isn't installed or isn't on PATH."
docker compose version >/dev/null 2>&1 || fail "The docker compose plugin isn't available."
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found. Copy .env.example to .env.local and fill it in."
if [[ "$NO_GIT" == false ]]; then command -v git >/dev/null || fail "git isn't installed (or use --no-git)."; fi

current_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/package.json" | head -n 1
}

# Reads KEY=value from the env file without executing it.
read_env() {
  local line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 && ("$value" == \"*\" || "$value" == \'*\') ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

container_exists() { docker container inspect "$1" >/dev/null 2>&1; }
container_running() { [[ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == true ]]; }

wait_healthy() {
  local name="$1" i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    if ! container_running "$name"; then
      warn "$name isn't running."
      return 1
    fi
    if [[ "$(docker container inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo 0)" -gt 0 ]]; then
      warn "$name keeps crashing and restarting."
      return 1
    fi
    if docker exec "$name" node -e "require('http').get('http://localhost:3002/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    printf '    (%d/%d) not ready yet; retrying in %ds\n' "$i" "$HEALTH_TRIES" "$HEALTH_DELAY"
    sleep "$HEALTH_DELAY"
  done
  return 1
}

PREV_VERSION="${FRANCINE_UPDATE_PREV_VERSION:-$(current_version)}"
PREV_REV="${FRANCINE_UPDATE_PREV_REV:-$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)}"
GIT_MOVED="${FRANCINE_UPDATE_GIT_MOVED:-false}"
WAS_RUNNING=false
container_running "$CONTAINER" && WAS_RUNNING=true
BUILT=false
APPLIED=false
NEW_VERSION="$PREV_VERSION"

restore_previous_source() {
  if [[ "$GIT_MOVED" == true && -n "$PREV_REV" ]]; then
    git -C "$APP_DIR" reset --hard --quiet "$PREV_REV" || warn "Couldn't move the code back to $PREV_REV."
  fi
}

restore_previous_image() {
  if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    return 0
  fi
  return 1
}

rollback() {
  warn "Rolling back to Francine $PREV_VERSION."
  restore_previous_source
  if ! restore_previous_image; then
    printf '\nThe upgrade failed and there is no previous image to go back to. Check: docker compose logs --tail=100 %s\n' "$CONTAINER" >&2
    exit 2
  fi
  local compose_file="$STATE_DIR/docker-compose.previous.yml"
  [[ -f "$compose_file" ]] || compose_file="$APP_DIR/docker-compose.yml"
  if docker compose --project-directory "$APP_DIR" -f "$compose_file" up -d --force-recreate --remove-orphans --no-build &&
    wait_healthy "$CONTAINER"; then
    printf '\nThe upgrade failed and was rolled back: Francine %s is running again.\n' "$PREV_VERSION" >&2
    printf 'The Google Sheet is not restored automatically; the backup taken before the upgrade is in %s.\n' "$BACKUP_DIR" >&2
    exit 1
  fi
  printf '\nThe upgrade failed and the rollback did not come back healthy. Check: docker compose logs --tail=100 %s\n' "$CONTAINER" >&2
  exit 2
}

on_exit() {
  local rc=$?
  set +e
  docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null 2>&1
  [[ $rc -eq 0 ]] && return
  trap - EXIT
  if [[ "$APPLIED" == true ]]; then
    rollback
  fi
  [[ "$BUILT" == true ]] && restore_previous_image
  restore_previous_source
  if [[ "$WAS_RUNNING" == true ]]; then
    printf 'Nothing was changed: Francine %s is still running.\n' "$PREV_VERSION" >&2
  else
    printf 'Nothing was changed.\n' >&2
  fi
  exit 1
}
trap on_exit EXIT
trap 'exit 130' INT TERM

save_rollback_material() {
  mkdir -p "$STATE_DIR"
  cp -f "$APP_DIR/docker-compose.yml" "$STATE_DIR/docker-compose.previous.yml"
  printf '%s\n' "$PREV_REV" >"$STATE_DIR/previous.rev"
  local image=""
  if container_exists "$CONTAINER"; then image="$(docker container inspect -f '{{.Image}}' "$CONTAINER")"; fi
  if [[ -z "$image" ]] && docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then image="$IMAGE:latest"; fi
  if [[ -n "$image" ]]; then
    docker tag "$image" "$IMAGE:previous"
  else
    docker image rm "$IMAGE:previous" >/dev/null 2>&1 || true
    warn "No current image found, so a failed upgrade can't be rolled back automatically."
  fi
}

update_source() {
  if [[ "$NO_GIT" == true ]]; then
    [[ -n "${FRANCINE_UPDATE_REEXEC:-}" ]] || log "Skipping git: building the working tree as it is."
    return
  fi
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$APP_DIR isn't a git checkout; use --no-git."
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    fail "There are uncommitted changes in $APP_DIR. Commit or stash them first, or use --no-git to build them as they are."
  fi

  local before rev tag
  before="$(sha256sum "$APP_DIR/update.sh")"
  if [[ -n "$ROLLBACK_REV" ]]; then
    rev="$(git rev-parse --verify --quiet "${ROLLBACK_REV}^{commit}")" || fail "Unknown commit or tag: $ROLLBACK_REV"
    log "Moving the code back to $rev"
    git reset --hard --quiet "$rev"
  elif [[ -n "$TARGET_VERSION" ]]; then
    log "Fetching release $TARGET_VERSION"
    git fetch --quiet --tags origin
    rev=""
    for tag in "v$TARGET_VERSION" "$TARGET_VERSION"; do
      if rev="$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}")"; then break; fi
      rev=""
    done
    [[ -n "$rev" ]] || fail "Release $TARGET_VERSION isn't tagged in the git repository (expected tag v$TARGET_VERSION)."
    if git merge-base --is-ancestor "$rev" HEAD; then
      log "This checkout already includes release $TARGET_VERSION."
    else
      git merge --ff-only --quiet "$rev" ||
        fail "Can't fast-forward to release $TARGET_VERSION: this checkout has commits that aren't in the release."
    fi
  else
    log "Pulling the latest code"
    git pull --ff-only --quiet
  fi

  [[ "$(git rev-parse HEAD)" != "$PREV_REV" ]] && GIT_MOVED=true
  NEW_VERSION="$(current_version)"
  if [[ -n "$TARGET_VERSION" && "$NEW_VERSION" != "$TARGET_VERSION" ]]; then
    warn "package.json says $NEW_VERSION but the requested release is $TARGET_VERSION."
  fi

  if [[ "$(sha256sum "$APP_DIR/update.sh")" != "$before" && -z "${FRANCINE_UPDATE_REEXEC:-}" ]]; then
    log "update.sh itself changed; continuing with the new copy."
    local args=(--no-git)
    [[ "$PULL" == true ]] && args+=(--pull)
    [[ "$SKIP_PREFLIGHT" == true ]] && args+=(--skip-preflight)
    trap - EXIT
    FRANCINE_UPDATE_REEXEC=1 FRANCINE_UPDATE_LOCKED=1 \
      FRANCINE_UPDATE_PREV_REV="$PREV_REV" FRANCINE_UPDATE_GIT_MOVED="$GIT_MOVED" \
      FRANCINE_UPDATE_PREV_VERSION="$PREV_VERSION" FRANCINE_UPDATE_TARGET_VERSION="$TARGET_VERSION" \
      exec "$APP_DIR/update.sh" "${args[@]}"
  fi
}

backup_sheet() {
  if ! container_running "$CONTAINER"; then
    warn "Francine isn't running, so the Google Sheet can't be backed up first. Continuing without a backup."
    return
  fi
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  local file
  file="$BACKUP_DIR/francine-sheets-$(date -u +%Y%m%d-%H%M%SZ)-v${PREV_VERSION:-unknown}.json"
  log "Backing up the Google Sheet to ${file#"$APP_DIR"/}"
  if ! (umask 077 && docker exec -i "$CONTAINER" node --input-type=module - <"$APP_DIR/scripts/backup-sheets.mjs" >"$file"); then
    rm -f "$file"
    fail "The backup of the Google Sheet failed, so the upgrade was stopped."
  fi
  if [[ "$(head -c 80 "$file")" != *'"format":"francine-sheets-backup"'* ]]; then
    rm -f "$file"
    fail "The backup of the Google Sheet came back empty, so the upgrade was stopped."
  fi
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'francine-sheets-*.json' -printf '%T@ %p\n' |
    sort -rn | tail -n "+$((KEEP_BACKUPS + 1))" | cut -d' ' -f2- |
    while IFS= read -r old; do rm -f -- "$old"; done
}

# The upgrade folder is bind-mounted into the container, so it must exist
# (owned by the container user) before docker compose creates it as root.
prepare_upgrade_folder() {
  local folder
  folder="$(read_env APP_UPGRADE_FOLDER)"
  folder="${folder:-./upgrade}"
  [[ "$folder" == /* ]] || folder="$APP_DIR/${folder#./}"
  export APP_UPGRADE_FOLDER="$folder"
  [[ ! -L "$folder" ]] || fail "$folder is a symbolic link; point APP_UPGRADE_FOLDER at a real folder."
  if [[ ! -d "$folder" ]]; then
    mkdir -p "$folder"
    chmod 770 "$folder"
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    chown "$APP_UID:$APP_GID" "$folder"
    chmod 770 "$folder"
  elif [[ "$(stat -c %u "$folder")" != "$APP_UID" ]]; then
    warn "$folder isn't owned by uid $APP_UID, so upgrading from the app won't work yet. Fix it with: sudo ./scripts/upgrade-agent.sh --install"
  fi
}

preflight() {
  if [[ "$SKIP_PREFLIGHT" == true ]]; then
    warn "Skipping the trial start (--skip-preflight)."
    return
  fi
  log "Trial-starting the new version in a throwaway container"
  docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null 2>&1 || true
  # No published ports and no upgrade folder: nothing can reach it, and
  # FRANCINE_PREFLIGHT=1 keeps it from touching Google Calendar.
  "${COMPOSE[@]}" run -d --no-deps --name "$PREFLIGHT_CONTAINER" \
    -e FRANCINE_PREFLIGHT=1 -e APP_UPGRADE_DIR=/nonexistent \
    francine >/dev/null
  if ! wait_healthy "$PREFLIGHT_CONTAINER"; then
    docker logs --tail 40 "$PREFLIGHT_CONTAINER" 2>&1 | sed 's/^/    | /' >&2 || true
    fail "The new version didn't start in the trial run."
  fi
  docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null
  log "Trial start passed."
}

log "Francine update — $(date '+%Y-%m-%d %H:%M:%S')"
[[ -n "${FRANCINE_UPDATE_REEXEC:-}" ]] || log "Running now: $PREV_VERSION"

[[ -n "${FRANCINE_UPDATE_REEXEC:-}" ]] || save_rollback_material
update_source
NEW_VERSION="$(current_version)"
prepare_upgrade_folder
backup_sheet

log "Building version $NEW_VERSION"
BUILT=true
build_args=()
[[ "$PULL" == true ]] && build_args+=(--pull)
"${COMPOSE[@]}" build ${build_args[@]+"${build_args[@]}"}

preflight

log "Restarting Francine on version $NEW_VERSION"
APPLIED=true
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans --no-build
wait_healthy "$CONTAINER" || fail "Francine $NEW_VERSION didn't become healthy after the restart."

docker image prune -f --filter "label=com.docker.compose.project=francine" >/dev/null 2>&1 || true
log "Done. Francine $NEW_VERSION is running."
