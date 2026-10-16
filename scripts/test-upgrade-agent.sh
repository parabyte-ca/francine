#!/usr/bin/env bash
# Tests scripts/upgrade-agent.sh against a temporary Francine folder with a
# fake update.sh. Needs root (the helper refuses to run without it):
#   sudo bash scripts/test-upgrade-agent.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(id -u)" -eq 0 ]] || {
  echo "Run as root: sudo bash scripts/test-upgrade-agent.sh" >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 755 "$TMP"
APP="$TMP/app"
UP="$APP/upgrade"
mkdir -p "$APP/scripts"
cp "$REPO/scripts/upgrade-agent.sh" "$APP/scripts/upgrade-agent.sh"
chmod 755 "$APP" "$APP/scripts" "$APP/scripts/upgrade-agent.sh"
AGENT="$APP/scripts/upgrade-agent.sh"

cat >"$APP/.env.local" <<'EOF'
APP_UPGRADE_FOLDER=./upgrade
APP_UPGRADE_ARGS="--pull --evil-flag * --skip-preflight"
EOF

cat >"$APP/update.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
printf '%s\n' "$*" >"$dir/update-args"
echo run >>"$dir/update-count"
echo "fake update running"
[[ -f "$dir/fake-sleep" ]] && sleep "$(cat "$dir/fake-sleep")"
rc="$(cat "$dir/fake-rc" 2>/dev/null || echo 0)"
if [[ "$rc" == 0 ]]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$2\"/" "$dir/package.json"
fi
exit "$rc"
EOF
chmod 755 "$APP/update.sh"

PASS=0
FAILED=0
ok() {
  PASS=$((PASS + 1))
  echo "ok - $1"
}
bad() {
  FAILED=$((FAILED + 1))
  echo "not ok - $1"
}
check() {
  local desc="$1"
  shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}
contains() { grep -q -- "$2" "$1" 2>/dev/null; }
lacks() { ! grep -q -- "$2" "$1" 2>/dev/null; }

reset_state() {
  rm -f "$UP/status.json" "$UP/upgrade.log" "$UP/request.json" \
    "$APP/update-args" "$APP/update-count" "$APP/fake-rc" "$APP/fake-sleep"
  printf '{\n  "name": "francine",\n  "version": "1.0.0"\n}\n' >"$APP/package.json"
}

request() { # request ID VERSION REQUESTED_BY
  printf '{"id":"%s","version":"%s","requested_by":"%s","requested_at":"%s"}\n' \
    "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$UP/request.json"
}

ID="0b6f4e2a-9c1d-4f3b-8a7e-2d5c6b1a9e0f"
EMAIL="owner@example.ca"

# ── Plain run with no request ────────────────────────────────────────────────
reset_state
bash "$AGENT"
check "creates the upgrade folder owned by uid 1001 with mode 770" \
  test "$(stat -c '%a %u %g' "$UP")" = "770 1001 1001"
check "writes agent.json with the default interval" contains "$UP/agent.json" '"every_minutes":15'
check "agent.json has a current last_seen" contains "$UP/agent.json" "\"last_seen\":\"$(date -u +%Y-%m-%dT%H)"
check "no request means no status.json" test ! -e "$UP/status.json"
check "leaves no temporary files behind" test -z "$(find "$UP" -name '.*.tmp')"

bash "$AGENT" --every 5
check "--every is reported in agent.json" contains "$UP/agent.json" '"every_minutes":5'

# ── Valid request ────────────────────────────────────────────────────────────
reset_state
request "$ID" 1.1.0 "$EMAIL"
bash "$AGENT"
check "valid request: status succeeded" contains "$UP/status.json" '"state":"succeeded"'
check "valid request: status names both versions" contains "$UP/status.json" 'from 1.0.0 to 1.1.0'
check "valid request: request.json removed" test ! -e "$UP/request.json"
check "valid request: update.sh gets the version and only allowed extra flags" \
  test "$(cat "$APP/update-args")" = "--version 1.1.0 --pull --skip-preflight"
check "valid request: upgrade.log has update.sh output" contains "$UP/upgrade.log" 'fake update running'
check "valid request: upgrade.log is a regular file" test -f "$UP/upgrade.log" -a ! -L "$UP/upgrade.log"

# ── Failed update ────────────────────────────────────────────────────────────
reset_state
echo 1 >"$APP/fake-rc"
request "$ID" 1.1.0 "$EMAIL"
bash "$AGENT"
check "failed update: status failed" contains "$UP/status.json" '"state":"failed"'
check "failed update: says which version is still running" contains "$UP/status.json" 'Francine 1.0.0 is still running'

reset_state
echo 2 >"$APP/fake-rc"
request "$ID" 1.1.0 "$EMAIL"
bash "$AGENT"
check "failed rollback: warns Francine may be offline" contains "$UP/status.json" 'may be offline'

# ── Malformed requests are ignored ───────────────────────────────────────────
for case in "bad-version|$ID|1.1|$EMAIL" "bad-id|1234|1.1.0|$EMAIL" \
  "bad-email|$ID|1.1.0|a;rm -rf /@x" "prerelease|$ID|1.1.0-beta|$EMAIL"; do
  IFS='|' read -r label id version by <<<"$case"
  reset_state
  request "$id" "$version" "$by"
  bash "$AGENT"
  check "malformed request ($label): ignored" contains "$UP/status.json" 'ignored an invalid upgrade request'
  check "malformed request ($label): update.sh not run" test ! -e "$APP/update-count"
  check "malformed request ($label): request removed" test ! -e "$UP/request.json"
done

reset_state
printf 'not json at all\n' >"$UP/request.json"
bash "$AGENT"
check "garbage request: ignored without running update.sh" test ! -e "$APP/update-count"

reset_state
{
  printf '{"id":"%s","version":"1.1.0","requested_by":"%s","pad":"' "$ID" "$EMAIL"
  head -c 70000 /dev/zero | tr '\0' a
  printf '"}\n'
} >"$UP/request.json"
bash "$AGENT"
check "oversized request: ignored" contains "$UP/status.json" 'too large'
check "oversized request: update.sh not run" test ! -e "$APP/update-count"

# ── Symbolic links planted by the app ────────────────────────────────────────
reset_state
printf '{"id":"%s","version":"1.1.0","requested_by":"%s","requested_at":"2026-01-01T00:00:00Z"}\n' "$ID" "$EMAIL" >"$TMP/outside.json"
ln -s "$TMP/outside.json" "$UP/request.json"
bash "$AGENT"
check "symlinked request: ignored" contains "$UP/status.json" 'symbolic link'
check "symlinked request: update.sh not run" test ! -e "$APP/update-count"
check "symlinked request: link target untouched" contains "$TMP/outside.json" '"version":"1.1.0"'

reset_state
echo sentinel >"$TMP/sentinel"
ln -s "$TMP/sentinel" "$UP/upgrade.log"
rm -f "$UP/agent.json"
ln -s "$TMP/sentinel" "$UP/agent.json"
request "$ID" 1.1.0 "$EMAIL"
bash "$AGENT"
check "planted links: target file never written" test "$(cat "$TMP/sentinel")" = sentinel
check "planted links: upgrade.log replaced by a regular file" test -f "$UP/upgrade.log" -a ! -L "$UP/upgrade.log"
check "planted links: agent.json replaced by a regular file" test -f "$UP/agent.json" -a ! -L "$UP/agent.json"

# ── Only one helper at a time ────────────────────────────────────────────────
reset_state
echo 3 >"$APP/fake-sleep"
request "$ID" 1.1.0 "$EMAIL"
bash "$AGENT" &
first=$!
for _ in $(seq 1 50); do
  grep -q '"state":"running"' "$UP/status.json" 2>/dev/null && break
  sleep 0.1
done
check "concurrent run: first helper reports running" contains "$UP/status.json" '"state":"running"'
request "$ID" 1.1.0 "$EMAIL"
start=$SECONDS
bash "$AGENT"
check "concurrent run: second helper exits at once" test $((SECONDS - start)) -lt 2
check "concurrent run: second helper leaves the new request alone" test -e "$UP/request.json"
wait "$first"
check "concurrent run: update.sh ran once" test "$(wc -l <"$APP/update-count")" -eq 1
check "concurrent run: first upgrade still finished" contains "$UP/status.json" '"state":"succeeded"'

# ── Options and refusals ─────────────────────────────────────────────────────
out="$(bash "$AGENT" --print)"
check "--print shows the cron line" grep -q -- '^  \*/15 \* \* \* \* root .*upgrade-agent.sh --every 15' <<<"$out"
out="$(bash "$AGENT" --print --every 1)"
check "--print --every 1 runs every minute" grep -q -- '^  \* \* \* \* \* root ' <<<"$out"
check "--every 7 is refused" bash -c "! bash '$AGENT' --print --every 7 2>/dev/null"
check "unknown options are refused" bash -c "! bash '$AGENT' --bogus 2>/dev/null"
if id nobody >/dev/null 2>&1; then
  check "refuses to run without root" bash -c "! runuser -u nobody -- bash '$AGENT' 2>/dev/null"
fi
mv "$APP/.env.local" "$APP/.env.moved"
check "refuses to run without the env file" bash -c "! bash '$AGENT' 2>/dev/null"
mv "$APP/.env.moved" "$APP/.env.local"

echo
echo "$PASS passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]]
