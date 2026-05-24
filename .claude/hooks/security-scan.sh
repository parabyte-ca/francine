#!/bin/bash
# Scans files written/edited for malicious code patterns.
# Called as a PostToolUse hook on Write|Edit events.
# Outputs blocking JSON and exits 1 if a pattern matches.

input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

[ -z "$file" ] || [ ! -f "$file" ] && exit 0

# Limit to file types worth scanning
case "$file" in
  *.json|*.js|*.ts|*.mjs|*.cjs|*.sh|*.bash|*.zsh|*.ps1|*.py|*.rb| \
  *.yaml|*.yml|Dockerfile|*.dockerfile|*.config.js|*.config.ts) ;;
  *) exit 0 ;;
esac

PATTERNS=(
  # curl/wget piped directly to a shell
  'curl[^|#"]*\|[[:space:]]*(sh|bash|zsh|dash|exec|python|perl|ruby|node)'
  'wget[^|#"]*\|[[:space:]]*(sh|bash|zsh|dash|exec|python|perl|ruby|node)'
  # base64-decode piped to shell / eval
  'base64[[:space:]]*(--decode|-d)[^|]*\|[[:space:]]*(sh|bash|exec|eval)'
  'atob\([^)]+\).*eval'
  # eval of a subshell network fetch
  'eval[[:space:]]*\$\((curl|wget)'
  # hidden binary dropped in /tmp and executed
  'chmod[[:space:]]+\+x[[:space:]]*/tmp/\.'
  '/tmp/\.[a-zA-Z0-9_-]+[[:space:]]*(&&|;|2>|>>|&[^&])'
  # npm lifecycle hooks with network calls
  '"(postinstall|preinstall|prepare|prepack)"[[:space:]]*:[[:space:]]*"[^"]*(curl|wget|fetch|exec|python|perl|ruby|node -e|bash -c|sh -c)'
  # reverse-shell patterns
  'bash[[:space:]]+-i[[:space:]]*>&[[:space:]]*/dev/tcp'
  '/dev/tcp/[0-9]'
  'nc[[:space:]]+-[a-z]*e[[:space:]]'
  # encoded payloads executed
  'fromCharCode.*eval'
  'Buffer\.from\([^)]+base64[^)]*\).*exec'
)

for pattern in "${PATTERNS[@]}"; do
  match=$(grep -nEi "$pattern" "$file" 2>/dev/null | head -3)
  if [ -n "$match" ]; then
    fname=$(basename "$file")
    # Escape for JSON
    safe_match=$(echo "$match" | head -1 | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/ /g')
    cat <<JSON
{
  "systemMessage": "🚨 SECURITY ALERT: Malicious pattern detected in $fname\n\nMatched line: $safe_match\n\nClaude has stopped. Inspect the file and confirm before proceeding.",
  "continue": false,
  "stopReason": "Security scan blocked: malicious pattern in $fname"
}
JSON
    exit 1
  fi
done

exit 0
