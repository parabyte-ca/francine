# Updates and upgrades

Francine can tell you when a new release is out, show its release notes, and
upgrade the server when you press one button. The app itself never gets Docker
or root access: a small helper on the server does the upgrade.

- [New releases](#new-releases)
- [Upgrading from the terminal](#upgrading-from-the-terminal)
- [Upgrading from the app](#upgrading-from-the-app)
- [Settings](#settings)
- [Publishing a release](#publishing-a-release)

## New releases

Francine checks the GitHub repository named by `APP_SOURCE_URL` for its latest
published release:

- **When:** once a day through `.github/workflows/update-check.yml`, which calls
  `GET /api/cron/check-updates` with the `CRON_SECRET` bearer token. Without that
  workflow, Francine checks when the Updates page is opened and the last answer
  is over a day old. **Check now** on the Updates page asks straight away; it
  checks GitHub at most once a minute and otherwise shows the last answer.
- **What is sent:** an anonymous request to
  `https://api.github.com/repos/{owner}/{name}/releases/latest`, with
  `User-Agent: Francine/<version>`. Nothing about your server or data is sent.
- **What is kept:** the version, name, release notes (up to 20,000 characters),
  link and publication date, saved in the `Config` tab of your Google Sheet
  (key `update_check`). If a check fails, the last known release is kept and the
  error is shown on the page.
- **Which tags count:** only plain versions such as `v1.2.3` or `1.2.3`. Drafts,
  pre-releases and tags like `1.2.3-beta` are ignored.

When a newer release appears, the **Updates** link in the sidebar gets a dot,
and a `system.update_available` event is written once per release to the
`Audit` tab of your Google Sheet. Its id is derived from your sheet and the
version, so repeated checks never add a second row.

## Upgrading from the terminal

On the server, from the Francine folder:

```bash
./update.sh --pull            # latest code; also refresh the Node base image
./update.sh --version 1.2.3   # a specific release (fast-forward only)
```

`update.sh` works in this order and stops before touching the running app if
anything goes wrong:

1. **Source:** `git pull --ff-only`, or the release tag with `--version`. It
   refuses to run with uncommitted changes. If the new code changes
   `update.sh` itself, it carries on with the new copy.
2. **Rollback material:** the running image is tagged `francine-crm:previous`
   and the current `docker-compose.yml` and commit are kept in `.update/`.
3. **Backup:** every tab of the Google Sheet is copied to
   `backups/francine-sheets-<time>-v<version>.json` (the last 10 are kept,
   readable only by the folder's owner).
4. **Build** the new image.
5. **Trial start:** the new image runs in a throwaway container with no ports
   and no Google Calendar access, and must answer its health check.
6. **Restart** Francine on the new image and check its health.
7. **Rollback** if the restarted app isn't healthy: the previous image, code and
   compose file go back, and their health is checked. Your Google Sheet is not
   restored automatically; Francine has no database migrations, and the backup
   from step 3 is there if you need it.

| Option | Effect |
|---|---|
| `--pull` | Refresh the Node base image while building (security updates). |
| `--version 1.2.3` | Move to release tag `v1.2.3` instead of the newest commit. |
| `--no-git` | Build the working tree as it is (old name: `--no-pull`). |
| `--skip-preflight` | Skip the trial start. |
| `--rollback-rev REV` | Go back to an earlier commit or tag. |

Exit codes: `0` upgraded; `1` failed and the previous version is still (or
again) running; `2` failed and the rollback didn't come back healthy. Only one
`update.sh` runs at a time.

> **Changed in 0.10.0:** `update.sh` no longer refreshes the Node base image on
> every run. Add `--pull` for the old behaviour.

## Upgrading from the app

### Set-up

Run once on the server, from the Francine folder:

```bash
./update.sh                                  # adds the shared folder to the container
sudo ./scripts/upgrade-agent.sh --install    # schedules the helper (every 15 minutes)
```

`--install` uses `/etc/cron.d/francine-upgrade` when cron is running, otherwise
a systemd timer (`francine-upgrade.timer`). It runs the helper once straight
away, so the Updates page shows **Connected** within a few seconds. Choose a
different interval with `--every N` (1, 2, 3, 4, 5, 6, 10, 12, 15, 20 or 30
minutes).

If the server's scheduler is managed somewhere else — for example a NAS web
interface, where `/etc` is replaced by system updates — run
`./scripts/upgrade-agent.sh --print` and add the command it shows as a root
task in that scheduler.

### Upgrading

On the **Updates** page, an owner (anyone in `ALLOWED_EMAILS`) presses
**Upgrade to x.y.z** and confirms. The helper starts the upgrade at its next
check, runs `update.sh --version x.y.z` and reports progress and the log back
to the page. Francine is unavailable for about a minute while it restarts;
reload the page when it says the upgrade is done.

### How it is kept safe

- The container gets no Docker socket and no root access. The only thing it
  shares with the host is the upgrade folder.
- An upgrade can only be requested from a signed-in browser session on
  Francine's own address: requests with an `Authorization` header or from
  another site are refused. Only the latest release, and only a version newer
  than the running one, can be requested; never while another upgrade is
  waiting or running, and only when the helper is connected. Each request is
  written to the `Audit` tab as `system.upgrade_requested`.
- The helper takes only a version string from the request, after checking it
  (and the request id and requester) against strict patterns. The code always
  comes from your git checkout. Extra `update.sh` options come only from
  `APP_UPGRADE_ARGS`, and only `--pull` and `--skip-preflight` are accepted.
- The helper treats the folder as hostile: it ignores requests that are
  symbolic links, not regular files or over 64 KB; it moves a request out of
  the folder before reading it; and it writes every file under an unguessable
  temporary name and then renames it into place, so a planted link can't make
  it write anywhere else. Only one helper runs at a time.
- `update.sh` runs as the account that owns the Francine folder, not as root,
  and that account must be able to use Docker.
- A request that waits more than an hour, or an upgrade that reports nothing
  for three hours, is shown as failed, so a stuck upgrade never blocks the next.

The helper runs as root from your checkout. Anyone who can change the files in
the Francine folder, or push to the repository it pulls from, can therefore run
commands as root on the server — keep both in trusted hands. (The same is
already true of anyone who can run `update.sh`, since Docker access is
equivalent to root.)

### Files in the upgrade folder

The folder (`APP_UPGRADE_FOLDER`, default `./upgrade`) is owned by uid 1001,
the container's user, with mode 770. Inside the container it is `/upgrade`.

| File | Written by | Contents |
|---|---|---|
| `request.json` | the app | `id`, `version`, `requested_by`, `requested_at` |
| `agent.json` | the helper | `last_seen`, `every_minutes` |
| `status.json` | the helper | `id`, `state` (`running`, `succeeded` or `failed`), `from_version`, `to_version`, `requested_by`, `started_at`, `finished_at`, `message` |
| `upgrade.log` | the helper | the output of `update.sh` (the page shows the last 64 KB) |

The helper counts as connected while it has checked in within
max(3, 2 × interval + 1) minutes — one missed run is tolerated — and its clock
isn't more than a minute ahead of the app's.

### Stopping upgrades from the app

- Cancel a waiting request: `rm upgrade/request.json`.
- Turn the feature off: `sudo ./scripts/upgrade-agent.sh --uninstall`. The page
  then shows the helper as not set up, and the upgrade button disappears.
  Release checks and terminal upgrades keep working.

## Settings

Set these in `.env.local`:

| Variable | Default | Meaning |
|---|---|---|
| `APP_SOURCE_URL` | `https://github.com/parabyte-ca/francine` | The GitHub repository whose releases are checked. |
| `APP_UPDATE_CHECK` | `true` | `false` turns off the daily and automatic checks; **Check now** still works. |
| `APP_UPGRADE_FOLDER` | `./upgrade` | The host folder shared with the container. Relative to the Francine folder. |
| `APP_UPGRADE_ARGS` | *(empty)* | Extra `update.sh` options for app-started upgrades: `--pull`, `--skip-preflight`. |

`docker-compose.yml` mounts the folder at `/upgrade` and sets
`APP_UPGRADE_DIR=/upgrade` for the app. If you move the folder, run Docker
Compose through `update.sh` (or export `APP_UPGRADE_FOLDER` first) so the mount
follows.

The daily check uses the `APP_URL` and `CRON_SECRET` repository secrets, the same
ones as the payment-reminders workflow.

## Publishing a release

The Updates page offers whatever is published as the latest GitHub release:

1. Bump the version in `package.json` and `README.md` and add a changelog entry.
2. Merge to `main`, then tag it: `git tag v1.2.3 && git push origin v1.2.3`.
3. On GitHub, draft a release from that tag and write the release notes in
   Markdown. Publish it (not as a pre-release).

The tag and the `package.json` version must match, or Francine keeps offering
the release after installing it.
