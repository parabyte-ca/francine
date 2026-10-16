#!/usr/bin/env bash
# scripts/upgrade-agent.sh — host helper that lets Francine upgrade itself.
#
# The app runs in a container with no Docker or root access. When an owner
# presses "Upgrade" it writes request.json to a shared folder; this helper,
# run as root on a schedule, picks the request up and runs ./update.sh as the
# account that owns the Francine checkout, reporting progress back.
#
# Usage (from the Francine folder):
#   sudo ./scripts/upgrade-agent.sh --install [--every N]  schedule it (default every 15 minutes) and run once
#   ./scripts/upgrade-agent.sh --print [--every N]          show the command and cron line to schedule yourself
#   sudo ./scripts/upgrade-agent.sh --uninstall              remove the schedule
#   sudo ./scripts/upgrade-agent.sh [--every N]              check once (what the schedule runs)
#
# Allowed N: 1 2 3 4 5 6 10 12 15 20 30
#
# Files in the upgrade folder (APP_UPGRADE_FOLDER in .env.local, default ./upgrade):
#   request.json  from the app: id, version, requested_by, requested_at
#   agent.json    from here:    last_seen, every_minutes
#   status.json   from here:    id, state, from_version, to_version, requested_by,
#                               started_at, finished_at, message
#   upgrade.log   from here:    output of update.sh
#
# Only the validated version string is taken from a request. The code always
# comes from the git checkout, and extra update.sh options come only from
# APP_UPGRADE_ARGS, limited to --pull and --skip-preflight.

set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
ENV_FILE="$APP_DIR/.env.local"
APP_UID=1001 # the nextjs user in the Dockerfile
APP_GID=1001
UNIT_NAME=francine-upgrade
CRON_FILE="/etc/cron.d/$UNIT_NAME"
UNIT_DIR=/etc/systemd/system
ALLOWED_EVERY=" 1 2 3 4 5 6 10 12 15 20 30 "
SEMVER_RE='^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
ID_RE='^[0-9a-fA-F-]{36}$'
EMAIL_RE='^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$'
MAX_REQUEST_BYTES=65536

MODE=run
EVERY=15
DIR=""
WORK=""
HEARTBEAT_PID=""
REQ_ID=""
TO_VERSION=""
FROM_VERSION=""
REQ_BY=""
STARTED_AT=""
FINISHED_AT=""
EXTRA_ARGS=()

die() {
  printf 'upgrade-agent: %s\n' "$*" >&2
  exit 1
}
say() { printf '%s\n' "$*"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
rand_hex() { od -An -N8 -tx1 /dev/urandom | tr -d ' \n'; }

usage() { sed -n '2,25p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'; }

require_root() { [[ "$(id -u)" -eq 0 ]] || die "this must run as root (try: sudo $0 $*)"; }

# Reads KEY=value from the env file without executing it.
read_env() {
  local line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 && ("$value" == \"*\" || "$value" == \'*\') ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

app_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/package.json" 2>/dev/null | head -n 1
}

json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}

resolve_folder() {
  local folder
  folder="$(read_env APP_UPGRADE_FOLDER)"
  folder="${folder:-./upgrade}"
  [[ "$folder" == /* ]] || folder="$APP_DIR/${folder#./}"
  printf '%s' "$folder"
}

ensure_folder() {
  [[ ! -L "$DIR" ]] || die "$DIR is a symbolic link; APP_UPGRADE_FOLDER must point at a real folder."
  [[ -d "$DIR" ]] || mkdir -p "$DIR"
  chown "$APP_UID:$APP_GID" "$DIR"
  chmod 770 "$DIR"
}

# The app owns the upgrade folder, so nothing here opens a fixed name in it.
# A file is written under an unguessable temporary name — noclobber makes bash
# open it with O_EXCL, which refuses anything already there, links included —
# then renamed into place; a rename never follows a link.
write_atomic() {
  local name="$1" content="$2" tmp
  tmp="$DIR/.$name.$(rand_hex).tmp"
  if ! (set -o noclobber && exec 3>"$tmp" && printf '%s\n' "$content" >&3); then
    rm -f -- "$tmp"
    return 1
  fi
  mv -fT -- "$tmp" "$DIR/$name" || {
    rm -f -- "$tmp"
    return 1
  }
}

write_agent() {
  write_atomic agent.json "{\"last_seen\":$(json_str "$(now_iso)"),\"every_minutes\":$EVERY}"
}

write_status() {
  local state="$1" message="$2"
  write_atomic status.json "$(printf '{"id":%s,"state":%s,"from_version":%s,"to_version":%s,"requested_by":%s,"started_at":%s,"finished_at":%s,"message":%s}' \
    "$(json_str "$REQ_ID")" "$(json_str "$state")" "$(json_str "$FROM_VERSION")" "$(json_str "$TO_VERSION")" \
    "$(json_str "$REQ_BY")" "$(json_str "$STARTED_AT")" "$(json_str "$FINISHED_AT")" "$(json_str "$message")")"
}

# upgrade.log is created the same way, then written through the open descriptor.
open_log() {
  local tmp
  tmp="$DIR/.upgrade.log.$(rand_hex).tmp"
  set -o noclobber
  exec 7>"$tmp"
  set +o noclobber
  mv -fT -- "$tmp" "$DIR/upgrade.log"
}

reject() {
  [[ "$REQ_ID" =~ $ID_RE ]] || REQ_ID=""
  [[ "$TO_VERSION" =~ $SEMVER_RE ]] || TO_VERSION=""
  [[ "$REQ_BY" =~ $EMAIL_RE ]] || REQ_BY=""
  FROM_VERSION="$(app_version)"
  STARTED_AT=""
  FINISHED_AT="$(now_iso)"
  write_status failed "The helper ignored an invalid upgrade request: $1."
  say "upgrade-agent: ignored the upgrade request: $1" >&2
}

json_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"\\\\]*\)\".*/\1/p" "$2" | head -n 1
}

run_update() {
  local owner
  owner="$(stat -c %U "$APP_DIR")"
  local cmd=("$APP_DIR/update.sh" --version "$TO_VERSION" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"})
  if [[ "$owner" == root ]]; then
    "${cmd[@]}"
    return
  fi
  [[ "$owner" != UNKNOWN ]] || {
    say "The Francine folder belongs to a user id with no account name."
    return 1
  }
  # Run git and docker as the checkout's owner so the files it creates keep
  # the right owner, and git doesn't refuse a checkout that root doesn't own.
  local home
  home="$(getent passwd "$owner" | cut -d: -f6 || true)"
  local as_owner
  if command -v runuser >/dev/null; then
    as_owner=(runuser -u "$owner" --)
  elif command -v sudo >/dev/null; then
    as_owner=(sudo -u "$owner" --)
  else
    say "Neither runuser nor sudo is available to run update.sh as $owner."
    return 1
  fi
  if ! "${as_owner[@]}" env HOME="${home:-/}" PATH="$PATH" docker info >/dev/null 2>&1; then
    say "The account that owns the Francine folder ($owner) can't use Docker, so update.sh can't run."
    return 1
  fi
  "${as_owner[@]}" env HOME="${home:-/}" PATH="$PATH" GIT_TERMINAL_PROMPT=0 "${cmd[@]}"
}

process_request() {
  local req="$DIR/request.json"
  [[ -e "$req" || -L "$req" ]] || return 0

  if [[ -f "$req" && ! -L "$req" ]] && (($(stat -c %s "$req" 2>/dev/null || echo 0) > MAX_REQUEST_BYTES)); then
    rm -f -- "$req"
    reject "the request file was too large"
    return 0
  fi
  # Take the request out of the app's reach before looking at it.
  WORK="$(mktemp -d "$(dirname "$DIR")/.francine-agent.XXXXXX")"
  mv -fT -- "$req" "$WORK/request.json" 2>/dev/null || return 0
  local f="$WORK/request.json"
  if [[ -L "$f" ]]; then
    reject "the request was a symbolic link"
    return 0
  fi
  if [[ ! -f "$f" ]]; then
    reject "the request wasn't a regular file"
    return 0
  fi
  if (($(stat -c %s "$f") > MAX_REQUEST_BYTES)); then
    reject "the request file was too large"
    return 0
  fi

  REQ_ID="$(json_field id "$f")"
  TO_VERSION="$(json_field version "$f")"
  REQ_BY="$(json_field requested_by "$f")"
  rm -f -- "$f"
  if ! [[ "$REQ_ID" =~ $ID_RE && "$TO_VERSION" =~ $SEMVER_RE && "$REQ_BY" =~ $EMAIL_RE ]]; then
    reject "it didn't contain a valid id, version and requester"
    return 0
  fi

  local raw=() arg
  read -ra raw <<<"$(read_env APP_UPGRADE_ARGS)"
  for arg in ${raw[@]+"${raw[@]}"}; do
    case "$arg" in
      --pull | --skip-preflight) EXTRA_ARGS+=("$arg") ;;
    esac
  done

  FROM_VERSION="$(app_version)"
  STARTED_AT="$(now_iso)"
  FINISHED_AT=""
  write_status running "Upgrading Francine from $FROM_VERSION to $TO_VERSION."
  open_log
  printf '==> Upgrade to %s requested by %s at %s\n' "$TO_VERSION" "$REQ_BY" "$STARTED_AT" >&7

  # Keep checking in while the upgrade runs so the page still shows the helper as connected.
  (
    exec 7>&- 9<&-
    while sleep 60; do write_agent || true; done
  ) &
  HEARTBEAT_PID=$!

  local rc=0
  run_update </dev/null >&7 2>&7 || rc=$?

  kill "$HEARTBEAT_PID" 2>/dev/null || true
  HEARTBEAT_PID=""
  write_agent || true
  FINISHED_AT="$(now_iso)"
  local running
  running="$(app_version)"
  printf '==> update.sh finished with exit code %s at %s\n' "$rc" "$FINISHED_AT" >&7
  exec 7>&-
  case "$rc" in
    0) write_status succeeded "Upgraded Francine from $FROM_VERSION to $running." ;;
    2) write_status failed "The upgrade to $TO_VERSION failed and the automatic rollback didn't come back healthy, so Francine may be offline. See the upgrade log." ;;
    *) write_status failed "The upgrade to $TO_VERSION failed; Francine $running is still running. See the upgrade log." ;;
  esac
}

cleanup() {
  [[ -z "$HEARTBEAT_PID" ]] || kill "$HEARTBEAT_PID" 2>/dev/null || true
  [[ -z "$WORK" ]] || rm -rf -- "$WORK"
}

run_once() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found; the helper reads Francine's settings from it."
  DIR="$(resolve_folder)"
  ensure_folder
  # Lock the folder itself so only one helper runs at a time.
  exec 9<"$DIR"
  flock -n 9 || exit 0
  trap cleanup EXIT
  write_agent
  process_request
}

schedule_cmd() { printf '%q --every %s' "$SCRIPT_PATH" "$EVERY"; }
cron_spec() { if [[ "$EVERY" == 1 ]]; then printf '* * * * *'; else printf '*/%s * * * *' "$EVERY"; fi; }

print_schedule() {
  say "Run this as root every $EVERY minute(s):"
  say "  $(schedule_cmd)"
  say ""
  say "As a line for /etc/crontab or a file in /etc/cron.d:"
  say "  $(cron_spec) root $(schedule_cmd) >/dev/null 2>&1"
  say ""
  say "In root's own crontab (sudo crontab -e), leave out the word \"root\"."
  say "On a NAS whose /etc is replaced by system updates, add the command in its scheduled-tasks page instead."
}

have_cron() {
  command -v cron >/dev/null || command -v crond >/dev/null || return 1
  if command -v pgrep >/dev/null; then
    pgrep -x cron >/dev/null || pgrep -x crond >/dev/null
  fi
}

have_systemd() { command -v systemctl >/dev/null && [[ -d /run/systemd/system && -w "$UNIT_DIR" ]]; }

remove_systemd_units() {
  if [[ -f "$UNIT_DIR/$UNIT_NAME.timer" || -f "$UNIT_DIR/$UNIT_NAME.service" ]]; then
    systemctl disable --now "$UNIT_NAME.timer" >/dev/null 2>&1 || true
    rm -f "$UNIT_DIR/$UNIT_NAME.timer" "$UNIT_DIR/$UNIT_NAME.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

install_schedule() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found; set up Francine first."
  DIR="$(resolve_folder)"
  ensure_folder

  if have_cron && [[ -d /etc/cron.d && -w /etc/cron.d ]]; then
    local tmp="/etc/cron.d/.$UNIT_NAME.tmp"
    {
      say "# Francine upgrade helper — installed by scripts/upgrade-agent.sh --install"
      say "SHELL=/bin/bash"
      say "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      say "$(cron_spec) root $(schedule_cmd) >/dev/null 2>&1"
    } >"$tmp"
    chmod 644 "$tmp"
    mv -fT -- "$tmp" "$CRON_FILE"
    remove_systemd_units || true
    say "Scheduled with cron ($CRON_FILE): every $EVERY minute(s)."
  elif have_systemd; then
    [[ "$SCRIPT_PATH" != *[\"%$'\n']* ]] || die "the Francine folder's path contains characters systemd can't run; use --print and schedule it yourself."
    cat >"$UNIT_DIR/$UNIT_NAME.service" <<EOF
[Unit]
Description=Francine upgrade helper
After=docker.service

[Service]
Type=oneshot
ExecStart="$SCRIPT_PATH" --every $EVERY
EOF
    cat >"$UNIT_DIR/$UNIT_NAME.timer" <<EOF
[Unit]
Description=Run the Francine upgrade helper every $EVERY minute(s)

[Timer]
OnCalendar=*:0/$EVERY
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$UNIT_NAME.timer" >/dev/null
    rm -f "$CRON_FILE"
    say "Scheduled with a systemd timer ($UNIT_NAME.timer): every $EVERY minute(s)."
  else
    say "Couldn't find a running cron or systemd to schedule the helper."
    say ""
    print_schedule
    exit 1
  fi

  say "Running the first check now…"
  (run_once)
  if [[ -f "$DIR/agent.json" ]]; then
    say "Done. Francine's Updates page should now show the helper as connected."
  fi
}

uninstall_schedule() {
  local removed=false
  if [[ -f "$CRON_FILE" ]]; then
    rm -f "$CRON_FILE"
    removed=true
  fi
  remove_systemd_units && removed=true
  if [[ -f "$ENV_FILE" ]]; then
    DIR="$(resolve_folder)"
    [[ -d "$DIR" && ! -L "$DIR" ]] && rm -f -- "$DIR/agent.json"
  fi
  if [[ "$removed" == true ]]; then
    say "Removed the schedule. Francine can no longer start upgrades from the app."
  else
    say "No schedule was installed."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) MODE=install ;;
    --uninstall) MODE=uninstall ;;
    --print) MODE=print ;;
    --every)
      [[ $# -ge 2 ]] || die "--every needs a number of minutes"
      EVERY="$2"
      shift
      ;;
    --every=*) EVERY="${1#*=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
[[ "$EVERY" =~ ^[0-9]+$ && "$ALLOWED_EVERY" == *" $EVERY "* ]] ||
  die "--every must be one of:$ALLOWED_EVERY(minutes)"

case "$MODE" in
  print) print_schedule ;;
  install)
    require_root --install
    install_schedule
    ;;
  uninstall)
    require_root --uninstall
    uninstall_schedule
    ;;
  run)
    require_root
    run_once
    ;;
esac
