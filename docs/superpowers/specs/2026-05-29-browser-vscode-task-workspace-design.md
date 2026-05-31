# Browser VS Code for Task Workspaces — Design

> Lets a user open a real, browser-based VS Code IDE rooted at a task's
> isolated workspace directory — conceptually a sibling to the existing
> Terminal tab — triggered from the `IssueDrawer`.

## 1. Problem

Each Symphony task/issue gets an isolated workspace directory on disk
(`SymphonyElixir.Workspace.path_for_issue/1`, under `Config.workspace_root()`),
which is exactly where the Codex agent does its work. Today the only in-browser
window into that directory is the **Terminal tab** (`Terminal.Registry` →
tmux over a Phoenix channel).

Users want a GitHub-style "press `.` to open VS Code" experience for a task —
but pointed at the **task workspace on disk**, not a no-compute web editor.
Because the workspace is a real directory (agent's files, git state, an existing
terminal), a github.dev-style editor (which reads/writes via an API and has no
terminal/LSP/compute) would be a downgrade. We want a real VS Code server
rooted at the folder.

## 2. Goal

1. Run a single, supervised `code-server` instance that Symphony starts when
   enabled.
2. From the `IssueDrawer`, open that task's workspace in full VS Code in a **new
   browser tab** via a button **and** a `.` keyboard shortcut.
3. Resolve the task's workspace path server-side using the same normalization
   the terminal uses, so the editor and the agent share the exact same directory.
4. Degrade gracefully (clear reason, disabled button) when the editor is
   disabled, still starting, unavailable, or the workspace doesn't exist yet.

## 3. Non-goals

- **Per-task isolated `code-server` instances.** One shared instance opens any
  task via `?folder=`. Considered and deferred.
- **Reverse-proxy routing through the `:4000` hub.** code-server runs on its own
  dedicated port and is opened directly. No websocket-proxy plumbing.
  > Note: `docs/superpowers/specs/2026-05-31-public-preview-tunnel-design.md` (D12)
  > supersedes this "no reverse-proxy through :4000" non-goal — the public preview
  > tunnel intentionally reverse-proxies dev servers through the :4000 hub.
- **Embedded iframe panel inside the drawer.** Opens full-screen in a new tab to
  avoid iframe keybinding/clipboard/focus quirks.
- **github.dev-style no-compute editing.** We have a real folder; we use a real
  server.
- **Auto-creating the workspace from the editor.** If the dir doesn't exist yet
  (agent hasn't run), the button is disabled with a `workspace_missing` reason
  rather than opening an empty editor. (The Terminal tab *does* auto-create; we
  intentionally do not mirror that here.)
- Multi-user auth / per-user sessions. Single-user assumption, consistent with
  the rest of Symphony.

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **Editor fidelity** = full VS Code via `code-server` (real server on the real folder). | Matches "github.dev `.`" intent for an on-disk workspace; gives file tree, extensions, integrated terminal, LSP, git. |
| D2 | **Process model** = one shared `code-server` instance for the whole hub; each task opens it with `?folder=<workspace path>`. | Simplest to supervise/route. All workspaces reachable from one instance — acceptable for a single-user local orchestrator. |
| D3 | **Launch surface** = new browser tab (the github.dev `.` behavior), full-screen. | Native keybindings/clipboard; no iframe quirks. |
| D4 | **Routing** = dedicated port (default `:4002`), opened directly as `<base_url>/?folder=<path>`. | No proxy code, no websocket-upgrade plumbing. |
| D5 | **Provisioning** = Symphony supervises `code-server` as a child process, started only when `editor.enabled`, restarted on crash. | "Just works" once configured. Missing binary / port-in-use degrade to unavailable without crashing the orchestrator. |
| D6 | **Workspace path** = resolved via `Workspace.path_for_issue/1` with the same `#`-stripping normalization `Terminal.Registry` uses (`workspace_identifier/1`). | Editor and agent share the identical directory. |
| D7 | **Missing workspace** = return `workspace_missing`; button disabled. No auto-create. | Avoids opening empty editors. Easy to flip later. |
| D8 | **`base_url` override** = browser-facing URL defaults to `http://<host>:<port>` but is configurable. | Handles remote/proxy host mismatches when Symphony binds `127.0.0.1`. |
| D9 | **Auth** = code-server `--auth none` by default; bind `127.0.0.1`. `auth: password` + `password` supported. | `--auth none` is only safe on localhost; docs warn about exposure. |
| D10 | **Config access** = a new `editor:` block in `WORKFLOW.md` front matter, read only through `SymphonyElixir.Config`. | Per repo convention; no ad-hoc env reads. |

## 5. Architecture

```
WORKFLOW.md (editor: block)
        │
        ▼
SymphonyElixir.Config  ──reads──▶  editor_enabled?/0, editor_binary/0,
                                   editor_host/0, editor_port/0,
                                   editor_auth/0, editor_password/0,
                                   editor_base_url/0
        │
        ▼ (if enabled, supervised in app tree)
SymphonyElixir.Editor.Server (Port-based GenServer)
   ├─ spawns: code-server --bind-addr <host>:<port> --auth <auth>
   ├─ health-polls port → status :starting | :ready | :unavailable
   ├─ restarts on crash; kills OS process on terminate
   └─ available?/0, status/0

SymphonyElixir.Editor (URL builder)
   editor_target(project_slug, issue_identifier)
     -> {:ok, url} | {:error, :disabled | :starting | :unavailable | :workspace_missing}

HTTP: GET /api/tracker/v1/projects/:project_slug/issues/:issue_identifier/editor
   -> { "data": { "available": true,  "url": "..." } }
   -> { "data": { "available": false, "reason": "disabled|starting|unavailable|workspace_missing" } }
   -> 404 for unknown project/issue

Frontend
   services/editor.ts          fetchEditorTarget(projectSlug, identifier)
   hooks/useIssueEditor.ts      { url, available, reason, loading } (fetch on drawer open)
   IssueDrawer                  "Open in VS Code" button (window.open(url, "_blank"))
                                + `.` shortcut (guarded against input/textarea focus)
```

### 5.1 Backend modules

**`SymphonyElixir.Config`** — add an `editor:` map to the NimbleOptions schema
(sibling to `observability:`/`server:`), plus module-attribute defaults and
public accessors with `@spec`:

```elixir
editor: [
  type: :map,
  default: %{},
  keys: [
    enabled: [type: :boolean, default: false],
    binary: [type: :string, default: "code-server"],
    host: [type: :string, default: "127.0.0.1"],
    port: [type: :pos_integer, default: 4002],
    auth: [type: {:in, ["none", "password"]}, default: "none"],
    password: [type: {:or, [:string, nil]}, default: nil],
    base_url: [type: {:or, [:string, nil]}, default: nil]
  ]
]
```

Accessors: `editor_enabled?/0`, `editor_binary/0`, `editor_host/0`,
`editor_port/0`, `editor_auth/0`, `editor_password/0`, and
`editor_base_url/0` (derives `"http://#{host}:#{port}"` when `base_url` is nil).

**`SymphonyElixir.Editor.Server`** — `Port`-based GenServer.
- `start_link/1` started by the app supervisor **only when** `editor_enabled?/0`.
- On init: spawn `code-server` via `Port.open({:spawn_executable, path}, args)`;
  begin health-polling the bind address until an HTTP probe succeeds → `:ready`.
- `available?/0` → `status == :ready`; `status/0` → `:starting | :ready | :unavailable`.
- Binary not found (resolve via `System.find_executable/1`) or port in use →
  log a clear warning, set `:unavailable`, **do not crash**.
- `terminate/2`: kill the OS process group.

**`SymphonyElixir.Editor`** — pure URL builder + readiness gate:
- `editor_target/2`:
  - `editor_enabled?/0` false → `{:error, :disabled}`
  - `Editor.Server.status/0` `:starting` → `{:error, :starting}`, `:unavailable` → `{:error, :unavailable}`
  - resolve `path = Workspace.path_for_issue(strip_leading_hash(issue_identifier))`
  - `File.dir?(path)` false → `{:error, :workspace_missing}`
  - else `{:ok, "#{Config.editor_base_url()}/?folder=#{URI.encode_www_form(path)}"}`

**Controller** (mirrors existing tracker controllers) — resolve project/issue
(404 if unknown), call `Editor.editor_target/2`, render `{ "data": ... }`.

**Router** — add the editor GET route alongside the other per-issue routes.

**`SymphonyElixir` app** — conditionally add `Editor.Server` to the supervision
tree when `Config.editor_enabled?/0`.

### 5.2 Frontend modules

- `tracker/src/services/editor.ts` — `fetchEditorTarget(projectSlug, identifier)`
  returning `{ available, url?, reason? }` (typed).
- `tracker/src/hooks/useIssueEditor.ts` — mirrors `useIssuePullRequests`/
  `useIssueComments`; fetches when `enabled && issue` and the drawer is open;
  returns `{ url, available, reason, loading, error }`.
- `IssueDrawer.tsx` — header button (lucide `Code`/`SquareCode` icon):
  `window.open(url, "_blank", "noopener")`. Disabled with a tooltip showing the
  reason when `!available`. A `.` key handler (added while the drawer is open)
  opens the editor, guarded so it never fires while focus is in an
  `input`/`textarea`/`contenteditable`.

## 6. Data flow

1. **Boot** → if `editor_enabled?`, supervisor starts `Editor.Server` → spawns
   `code-server` → health-polls to `:ready`.
2. **Drawer opens** → `useIssueEditor` GETs the editor endpoint → backend checks
   server readiness, resolves the workspace path, checks dir existence → returns
   URL or a reason.
3. **Button / `.`** → `window.open(url)` → code-server loads at `?folder=<workspace>`.

## 7. Error handling & edge cases (explicit)

| Case | Behavior |
|---|---|
| `editor.enabled` false | Endpoint `reason: "disabled"`; button hidden/disabled. |
| Binary not found | App still boots; server `:unavailable`; endpoint `reason: "unavailable"`; clear log warning. |
| Port already in use | Server fails to start, logged; `:unavailable`; orchestrator unaffected. |
| code-server still starting | `reason: "starting"`; button shows spinner/disabled, refetch shortly. |
| Workspace dir missing | `reason: "workspace_missing"`; button disabled with tooltip. |
| Remote / proxy host | `base_url` config overrides the derived host so the browser URL is correct. |
| Path with spaces/special chars | `URI.encode_www_form/1` on the folder path. |
| Unknown project/issue | Controller returns 404. |
| Focus in a text field | `.` shortcut is suppressed so it never hijacks typing. |

## 8. Testing

- **Config** (`config_test.exs`): defaults when `editor:` omitted; reads
  configured keys; `editor_base_url/0` derives from host/port and respects the
  override.
- **`Editor.Server`**: inject a fake spawner/probe; assert status transitions
  (`:starting` → `:ready`), unavailable on missing binary, no crash on failure.
- **`Editor` (URL builder)**: each branch — disabled, starting, unavailable,
  workspace_missing, and a correctly encoded `?folder=` URL for an existing dir;
  verify `#`-stripping normalization matches the terminal's.
- **Controller**: 200 with URL, 200 unavailable + reason, 404 unknown issue.
- **Frontend** (Vitest): `editor.ts` service shape; `useIssueEditor` states
  (loading/available/reason); `IssueDrawer` button enabled/disabled + `.`
  shortcut guarded against input focus.

## 9. Docs to update (same change)

- `elixir/README.md` — editor feature + run instructions.
- `WORKFLOW.md` (and `WORKFLOW.*.example.md`) — the `editor:` config block.
- `elixir/docs/troubleshooting.md` — code-server not installed / port in use /
  remote `base_url`.
- Security note: `--auth none` is localhost-only; warn before exposing `:4002`.

## 10. Open questions

None. All major forks resolved: full VS Code (D1), shared instance (D2), new tab
(D3), dedicated port (D4), Symphony-supervised (D5), no auto-create (D7).
