# Troubleshooting Guide

A guide to common issues encountered during Symphony setup and how to resolve them.

## Environment Variables & Authentication

### GitHub Token (`GITHUB_TOKEN`)

Symphony uses the GitHub Issues API to fetch issues, update labels, and post comments.
The `GITHUB_TOKEN` environment variable must be set.

**Required scopes:**

| Scope | Purpose |
|-------|---------|
| `repo` | Read/write access to issues, PRs, and labels in private repositories |
| `issues:write` | Post issue comments, update labels, close issues |
| `pull_requests:write` | Required if the agent creates PRs |

If using a **fine-grained personal access token**:
- **Repository access**: Select the target repository
- **Issues**: Read and write
- **Pull requests**: Read and write (if PR creation is needed)
- **Contents**: Read (to read repository contents)

If using a **classic personal access token**:
- Select the `repo` scope (for private repos) or `public_repo` (for public repos)

**Setting the token:**

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Symptoms & Diagnosis:**

If the token is missing or has insufficient permissions, Symphony will start but produce repeated errors during polling:

```
error: GitHub token missing - set GITHUB_TOKEN env var
```

Or if the token exists but lacks required permissions:

```
error: GitHub API request failed status=403
error: GitHub API request failed status=404
```

- `403`: Insufficient token permissions. Check the required scopes listed above.
- `404`: No access to the repository, or the `github.repo` config value is incorrect.

### Linear API Key (`LINEAR_API_KEY`)

Required when using the Linear tracker.

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

To generate a key: Linear > Settings > Security & access > Personal API keys

## WORKFLOW.md Prompt Template Errors

### Undefined Variable Error

```
(Solid.RenderError) Undefined variable issue.number
```

**Cause**: The prompt template references a variable name that does not exist on the `Issue` struct.

**Available template variables:**

| Variable | Type | Description |
|----------|------|-------------|
| `issue.id` | String | Unique issue ID (GitHub: issue number) |
| `issue.identifier` | String | Issue identifier (GitHub: issue number, Linear: issue key) |
| `issue.title` | String | Issue title |
| `issue.description` | String | Issue body |
| `issue.state` | String | Current state (e.g., `todo`, `in-progress`) |
| `issue.url` | String | Issue web URL |
| `issue.labels` | List | List of labels |
| `issue.assignee_id` | String | Assignee ID (GitHub: login, Linear: user ID) |
| `issue.priority` | Integer | Priority (1-4, nil) |
| `issue.branch_name` | String | Associated branch name (Linear) |
| `issue.created_at` | DateTime | Creation timestamp |
| `issue.updated_at` | DateTime | Last updated timestamp |
| `attempt` | Integer | Retry count (nil on first run) |

**Common variable name mistakes:**

| Incorrect | Correct |
|-----------|---------|
| `issue.number` | `issue.identifier` |
| `issue.assignees` | `issue.assignee_id` |
| `issue.body` | `issue.description` |
| `issue.status` | `issue.state` |

**Correct template example:**

```liquid
You are working on GitHub Issue `#{{ issue.identifier }}` in `owner/repo`.

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
URL: {{ issue.url }}
Assignee: {{ issue.assignee_id }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}
```

### JSON Encoding Error (Non-ASCII Characters)

```
(Jason.EncodeError) invalid byte 0xEC in <<...>>
```

**Cause**: The WORKFLOW.md file is saved in a non-UTF-8 encoding (e.g., EUC-KR, CP949),
or the issue data contains invalid bytes.

**Solution:**

1. Verify that WORKFLOW.md is saved as UTF-8:
   ```bash
   file -bi WORKFLOW.md
   # Expected: text/plain; charset=utf-8
   ```
2. If it's not UTF-8, convert it:
   ```bash
   iconv -f EUC-KR -t UTF-8 WORKFLOW.md > WORKFLOW.utf8.md
   mv WORKFLOW.utf8.md WORKFLOW.md
   ```
3. Explicitly set the encoding to UTF-8 when saving in your editor.

## Agent Setup

### Claude Backend

`symphony-claude` must be installed:

```bash
brew install symphony-claude
```

WORKFLOW.md configuration:

```yaml
claude:
  command: symphony-claude
```

### Codex Backend

```yaml
codex:
  command: codex app-server
```

## Workspace Issues

### Hook Execution Failure

If `git clone` fails in `hooks.after_create`:

```
Agent run failed for issue_id=...: hook_failed
```

**Checklist:**
- Verify that SSH keys are configured (`ssh -T git@github.com`)
- Verify that the Git URL is correct
- If using `mise`, make sure you have run `mise trust`

### Workspace Disk Space

Each issue clones the repository, which can consume significant disk space.
Using `--depth 1` for a shallow clone is recommended:

```yaml
hooks:
  after_create: |
    git clone --depth 1 git@github.com:owner/repo.git .
```

## GitHub Projects v2 Setup

### GitHub Projects v2 board not created

Symphony bootstraps a project automatically on startup. If
`.symphony/github-project.json` is missing or stale:

1. Check that `GITHUB_TOKEN` has `project` scope (read+write).
2. Delete `.symphony/github-project.json` and restart Symphony to retry.
3. If a partial bootstrap left an orphan project on GitHub, the log will
   print its URL. You can delete it on github.com or reuse it by setting
   `github.project.mode: existing` and `github.project.id: <node-id>` in
   `WORKFLOW.md`.

### WORKFLOW state removed but still in use

Symphony halts startup when `WORKFLOW.md` drops a Project `Status` option that
project items still use:

1. Open the project URL from the error message.
2. Move affected items to another column/state.
3. Restart Symphony (unused options can remain on the field; Symphony does not
   delete them via API).

Adding a **new** state to `tracker.active_states` or `tracker.terminal_states`
is applied automatically on startup via `updateProjectV2Field`.

### `github.assignee: me` fails at startup

Ensure `.symphony/github-project.json` exists and includes `viewer_login`, or
delete the cache and restart so bootstrap can resolve `viewer { login }`.

### Issues are not picked up

1. Confirm the issue is OPEN in the repo.
2. Confirm the issue carries the `symphony` label (or the value configured
   in `github.admission_label`).
3. Wait one poll cycle (default 60s) for admission and state initialization.
4. Check the orchestrator log for `Admission failed for issue ...` warnings.

## GitHub Rate Limits & Polling Cadence

If GitHub returns repeated `403`/`429` rate-limit errors, Symphony is reading from
GitHub more often than the token's quota allows. Reads come from a few places, and
most are served from the local SQLite mirror — the background sync engine is the
main spender of GitHub quota.

### Who calls GitHub

| Source | When | Cost |
|--------|------|------|
| Background sync (`Tracker.Sync.Engine` → `GitHub.SyncDriver`) | Every poll, per sync-enabled project | One light `list_issues` (paginated) per pull, plus comments + PRs only for issues in an **active state** |
| Orchestrator poll loop | Every `SYMPHONY_POLL_INTERVAL_MS` | Reads candidate issues from the **local mirror** (no GitHub call) and requests a (coalesced) sync |
| PR drawer / board (`PullRequestController`) | On demand from the UI | Live PR + checks reads, cached for 60s in the shared `ReadCache` |
| Agent open-PR check (`AgentRunner`) | Each turn for `In Progress` GitHub issues | One open-PR lookup, cached per repo+issue for ~2 minutes |
| On-demand "Sync from remote" (`Engine.sync_issue/3`) | When a user clicks it | Full enrich (issue + comments + PRs) for that single issue |

### Tuning knobs

These are process-level (instance-wide) settings; set them in `elixir/.env`
(sourced by `make serve`) and restart Symphony.

| Variable | Default | Effect |
|----------|---------|--------|
| `SYMPHONY_POLL_INTERVAL_MS` | `60000` | Orchestrator poll cadence. Lower it for faster dispatch of newly-assigned issues; it does not by itself add GitHub reads (dispatch reads the local mirror). |
| `SYMPHONY_TRACKER_SYNC_MIN_PULL_MS` | `60000` | Minimum spacing between remote pulls for a single project. A pull requested sooner is coalesced to a push-only sync (queued writes still flush). |
| `SYMPHONY_TRACKER_PR_SYNC_TTL_MS` | `300000` | An issue's pull requests/comments are re-enriched from GitHub at most once per this window during background sync. |

To pick up dispatches quickly without hammering GitHub, keep a short poll interval
and a longer pull/enrich interval, e.g.:

```bash
SYMPHONY_POLL_INTERVAL_MS=5000
SYMPHONY_TRACKER_SYNC_MIN_PULL_MS=60000
SYMPHONY_TRACKER_PR_SYNC_TTL_MS=300000
```

Watch the structured `tracker_sync ...` log lines to confirm the cadence: a coalesced
sync logs `skipped_pull=true`, and a pull reports how many issues it `enriched`.

## Creating Issues From the Tracker UI

The tracker "Create issue" modal creates issues for **local, GitHub, and Linear**
projects. For GitHub and Linear the issue is created on the remote board, added to
the configured project, and moved to the selected status.

The modal lets you pick **labels**, **assignees**, and a **CLI agent** (Codex or
Claude). The agent selector adds the `symphony:codex` / `symphony:claude` label;
the chosen **Status** is the dispatch gate (e.g. create in `Todo` to have an agent
start immediately, or in `Backlog` to only label it).

### Create returns `501 tracker_not_supported`

This was the previous behavior for remote trackers and now indicates a
misconfiguration:

1. Confirm the project's `tracker_kind` is `github` or `linear` (creation is not
   supported for other kinds).
2. Confirm `GITHUB_TOKEN` (issue write + `project` scope) or `LINEAR_API_KEY`
   (write access) is set on the **Symphony server** process, not just your shell.

### Labels or assignees are empty in the modal

The option lists are fetched live from the remote (`GET
/api/tracker/v1/projects/:slug/issues/form_options`). An empty list usually means
the token cannot read repo labels / assignable users, or the GitHub repo / Linear
team has none. Check the server log for a `tracker_*` error.

## Browser Editor (code-server)

The tracker `IssueDrawer` shows an **Open in VS Code** button (and a `.` keyboard
shortcut) that opens the task's workspace in browser-based VS Code. It depends on the
process-wide editor settings (`SYMPHONY_EDITOR_*` env vars, or the `editor:` block in
`WORKFLOW.md` / `$SYMPHONY_WORKFLOW` when those env vars are unset).

### "Open in VS Code" button is missing

The editor is disabled at the process level. Either set `SYMPHONY_EDITOR_ENABLED=true`
in `elixir/.env`, or keep `editor.enabled: true` in `WORKFLOW.md` (or the file named
by `SYMPHONY_WORKFLOW`), then restart Symphony (`make stop && make serve`, or
`make update ARGS="--all"` after changing `.env`).

### Button is disabled showing "Editor is starting…"

`code-server` is still booting. Wait a moment and retry; the button enables once the
process accepts connections.

### Button is disabled showing "Workspace not created yet"

The task's workspace directory does not exist yet — Symphony does **not** auto-create it.
Run the agent on the issue, or open the **Terminal** tab first, then retry.

### code-server not found

The log warns:

```
Editor server unavailable: binary not found binary=code-server
```

Install code-server on the host, or set `editor.binary` to its absolute path:

```yaml
editor:
  enabled: true
  binary: /usr/local/bin/code-server
```

### Port already in use

If `editor.port` (default `4002`) collides with another service, change it:

```yaml
editor:
  port: 4010
```

### Exposing the editor remotely

`auth: none` is only safe on localhost (the default bind is `127.0.0.1`). To reach the
editor from another machine, require a password and set the browser-facing URL:

```yaml
editor:
  enabled: true
  host: 0.0.0.0
  auth: password
  password: your-password
  base_url: https://editor.example.com
```

Never use `auth: none` when binding off localhost.

## Issue Preview Servers

Issue previews depend on `WORKFLOW.md` front matter and the project's saved DevEnv
steps. A workspace repo's `.symphony/devenv.yaml` feeds DevEnv proposal/discovery, but
you still need to propose/save or import those steps before previews can auto-start.

### Preview link is missing

Common causes:

- `dev_server.enabled` is missing or false in `WORKFLOW.md`.
- The issue workspace has not been created yet. Run the agent or open the **Terminal**
  tab first.
- The project has no saved DevEnv step with `role: serve`. If you use a convention
  file, add a `.symphony/devenv.yaml` serve step and save/import it through DevEnv:

```yaml
steps:
  - description: Front dev server
    command: npm run dev
    working_dir: front
    role: serve
    port_env: PORT
    url_path: /
    ready: http
    ready_path: /health
    primary: true
```

`role: setup` steps prepare the workspace. `role: serve` steps are long-running preview
servers. Multiple serve steps are allowed; `primary: true` selects the URL shown first
in the Summary tab.

### Preview stays provisioning or starting

Check the serve step:

- `port_env` must match the environment variable your dev server uses for its port
  (for example `PORT`).
- `ready: tcp` waits for the allocated port to accept connections.
- `ready: http` sends an HTTP probe to `ready_path` on localhost; make sure the route
  is responsive and returns an HTTP response below 500.
- `working_dir` is relative to the issue workspace unless omitted.

### No preview port is available

Symphony allocates ports from `dev_server.port_range` (default `[4100, 4199]`) and
starts previews until no free port remains in that range. Stop previews you no
longer need or widen the range if the host can support more servers.

### Preview is stale, stopped, or crashed

The Summary tab only links ready servers; stopped rows may remain as last-known status.
Use the Preview tab's **Start Preview**, **Stop Preview**, or **Restart Preview**
controls to reconcile the row.

Dev servers run in tmux sessions named:

```
sym-dev-<project>-<issue>-<serve-step>
```

Use tmux to inspect the pane output, or check the Symphony log for dev-server warnings
and health probe failures.

## Public Preview Tunnel

The public preview tunnel exposes the tracker and ready dev-server previews via a
Cloudflare named tunnel. It depends on `public_tunnel.enabled: true` in `WORKFLOW.md`,
the Cloudflare credentials in `elixir/.env`, and a running `cloudflared` process.

### `cloudflared` not found

The `make tunnel` targets shell out to `cloudflared`:

```
make: cloudflared: No such file or directory
```

Install the Cloudflare Tunnel client and ensure it is on `PATH`:

```bash
# macOS
brew install cloudflared
# then verify
cloudflared --version
```

### Cloudflare error 1033 / "Argo Tunnel error"

A public host loads the Cloudflare error page with code **1033**. The tunnel is not
running or its DNS records are missing, so Cloudflare cannot reach the origin.

1. Start the tunnel: `make tunnel` (foreground) or `make tunnel-bg`.
2. Confirm it is up: `make tunnel-status` (and `make tunnel-logs` for output).
3. (Re)create the apex + wildcard CNAMEs: `make tunnel-dns`.

### TLS / certificate error on `*.<namespace>.tracker.cods.dev`

Nested wildcard hosts (`<preview>.<namespace>.tracker.cods.dev`) fail with a TLS /
certificate error while `<namespace>.tracker.cods.dev` works. Universal SSL only covers
a **single** wildcard level, so the nested wildcard needs **Advanced Certificate Manager
(ACM)**.

1. Enable ACM for the `cods.dev` zone in the Cloudflare dashboard.
2. Order an ordered certificate that includes `*.<namespace>.tracker.cods.dev`.
3. Wait for the certificate to become **active** before retrying the preview host.

### Preview returns 404 "Unknown preview host"

The host is inside the namespace but `PublicHostPlug` has no matching dev server in the
`SymphonyElixir.PublicRouting` registry.

- The dev server is not `:ready` yet (still provisioning/starting) or has not registered.
  Open the issue's **Preview** tab and start/await the server.
- The host's namespace does not match the configured namespace. Confirm
  `PUBLIC_NAMESPACE` / `public_tunnel.namespace` resolves to the same `<namespace>` used
  in the URL (it defaults to the sanitized GitHub login).

### Port already in use

The tunnel routes to dev-server loopback ports; if another process already holds a port
in the dev-server range (`dev_server.port_range`, default `[4100, 4199]`), the preview
cannot bind. Stop the conflicting process or widen the range. See **No preview port
is available** above.

## Checking Logs

Check the log files when diagnosing issues:

```bash
# Default log location
tail -f log/symphony.log

# Custom log path
symphony --logs-root /path/to/logs WORKFLOW.md
```

## FAQ

### Symphony starts but doesn't fetch any issues

1. Verify that `GITHUB_TOKEN` or `LINEAR_API_KEY` is set
2. Verify that `github.repo` is in `owner/repo` format
3. Confirm new issues carry the `symphony` admission label (or the value
   configured in `github.admission_label`)
4. Confirm the token has access to the target repository and the `project`
   scope when using the GitHub tracker

### The agent keeps retrying in a loop

Check the error messages in the logs. Common causes:
- Incorrect variable names in the prompt template (see "Undefined Variable Error" above)
- WORKFLOW.md encoding issues (see "JSON Encoding Error" above)
- `symphony-claude` or `codex` command not found in PATH

### Can't access the observability dashboard

The dashboard is enabled by specifying a port with the `--port` option:

```bash
symphony --port 4000 WORKFLOW.md
```

Then access it at `http://127.0.0.1:4000`.
