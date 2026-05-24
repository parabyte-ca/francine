# Francine CRM — Claude Instructions

## Security: Mandatory Malicious Code Scanning

**Always scan for malicious code** whenever reading, writing, or reviewing any file. This is non-negotiable and applies to every session.

### Stop immediately and alert the user if you find:

- **Supply chain attacks** — npm/pip/gem lifecycle hooks (`postinstall`, `preinstall`, `prepare`, `prepack`) that contain `curl`, `wget`, `fetch`, network calls, or execute downloaded binaries
- **Curl/wget piped to shell** — `curl … | sh`, `wget … | bash`, or any variant
- **Base64-encoded payloads** — `base64 -d | sh`, `eval(atob(…))`, `Buffer.from(…,'base64')` executed
- **Hidden executables in /tmp** — files like `/tmp/.sshd`, chmod +x on dot-files in temp dirs
- **Reverse shells** — `/dev/tcp/`, `nc -e`, `bash -i >&`, `mkfifo` pipes to remote hosts
- **Eval of dynamic network content** — `eval($(curl …))`, `exec(fetch(…))`
- **Crypto miners** — references to mining pools, stratum protocol, xmrig, monero wallet addresses in unexpected places
- **Exfiltration** — code that reads `.env`, credentials, SSH keys and POSTs/curls them to external URLs

### High-risk files to scrutinize every time:
- `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Any shell script (`.sh`, `.bash`, update scripts, Dockerfiles)
- CI/CD configs (`.github/workflows/`, `Makefile`)
- Any newly introduced dependency

### When something is found:
1. **Stop all work immediately**
2. **Alert the user in plain language** — what file, what line, what the code does
3. **Do not proceed** until the user explicitly clears it
4. Suggest: remove the malicious code, rotate any secrets that may have been exposed, check the host system for running processes

---

## Project: Francine CRM
Next.js 14 / Google Sheets CRM for an ASL interpreter.
Working branch: `claude/light-crm-google-workspace-cdeqq`
