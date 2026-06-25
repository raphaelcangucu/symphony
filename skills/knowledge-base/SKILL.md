---
name: knowledge-base
description: |
  Work with Symphony's Git-backed knowledge base (Notion-like docs stored as
  Markdown in each repo's docs/ folder, plus the per-user symphony-kb repo). Use
  when creating, editing, searching, linking, or syncing KB pages, or when wiring
  the KB assistant tools and HTTP API.
---

# Knowledge Base

Symphony's knowledge base is **Markdown in Git**, presented with a Notion-like
editor. There is no separate document database: the files in each repository's
`docs/` folder are the source of truth, and a SQLite FTS5 index mirrors them for
full-text search only.

Use this skill whenever you read, write, search, link, or sync KB pages — from
the assistant tools, the HTTP API, or the Elixir core.

## Mental model

- **Project KB** = the aggregated `docs/` folders of every repository linked to a
  Symphony project. A project can span multiple repositories; each contributes
  its own `docs/` tree, grouped per repository in the sidebar.
- **General (user) KB** = a private `symphony-kb` repository in the user's
  personal GitHub account, addressed under the `@user` scope. Its home page lists
  links to every project and can be regenerated.
- **Pages** are addressed by `(repository, path-within-docs)`. Page files always
  end in `.md`.
- **Assets** (images) live in `docs/assets/` and are content-hashed.

## Layout & file conventions

```
<workspace_root>/<project_slug>/<repo.workspace_path>/docs/<relative_path>.md
<workspace_root>/<project_slug>/<repo.workspace_path>/docs/assets/<hash>.<ext>
```

- A page is a Markdown file. Optional YAML **frontmatter** carries metadata
  (`title`, cover/icon, `generated`, etc.); the body is plain Markdown.
- The display **title** comes from frontmatter `title`, else the first H1, else
  the filename.
- Path segments must match `^[a-zA-Z0-9._-]+$` (no spaces, no `..`, no `/` inside
  a segment). The path must end in `.md`. Invalid paths return
  `:kb_invalid_path`.

## Repository addressing (repo_slug)

A `workspace_path` can contain `/`, which a single URL segment cannot hold, so
`/` is encoded as `~` (a character the repository changeset forbids in
`workspace_path`), making the mapping lossless:

- `repo_slug` = `workspace_path` with `/` → `~` (e.g. `apps/web` → `apps~web`).
- Decode with the inverse. The general KB's repo slug is `@user~symphony-kb` and
  its scope is `@user`.

Helpers live in `SymphonyElixir.KnowledgeBase.Paths` (Elixir) and
`tracker/src/lib/kbRoutes.ts` (frontend).

## Assistant tools (repo-aware)

`SymphonyElixir.Assistant.KnowledgeBaseTools` exposes these tools through the
project chat, freeform chat, and Codex sessions (registered in `ToolExecutor`
and `ProjectBoardTools`). All are scoped to a project; freeform calls must also
pass `project_slug`.

| Tool | Purpose |
|------|---------|
| `kb_list_repositories` | List the project's repos and whether each has docs. |
| `kb_search_pages` | Full-text search (title + body). Required: `query`. Optional: `repository`. |
| `kb_read_page` | Read a page. Required: `path`. |
| `kb_create_page` | Create a new page; fails if it already exists. Required: `path`, `body`. Optional: `title`. |
| `kb_update_page` | Update an existing page. Required: `path`, `body`. |
| `kb_link_task` | Append a tracker issue reference into a page. Required: `path`, `identifier`. |
| `kb_sync` | Trigger sync (merge default branch, open/update PR, auto-merge when green). |

### The `repository` argument and ambiguity rule

`repository` accepts an `owner/name`, a `workspace_path`, or a `repo_slug`.

- If the project has **exactly one** repository, omit it — the tool resolves it.
- If the project has **several** and you omit `repository`, the tool does NOT
  guess. It returns a remediation (`remediation: "needs_repository"`) telling you
  to **ASK the user which repository**, then call again with `repository` set.
  Never pick a repository on the user's behalf.

### Good practice

- Call `kb_search_pages` before `kb_create_page` to avoid duplicates.
- Use `kb_create_page` for new pages and `kb_update_page` for existing ones; the
  wrong one returns `:kb_page_exists` / `:kb_page_not_found`.
- After a batch of edits, `kb_sync` to publish.

## HTTP API

Project KB (under the tracker scope):

```
GET  /projects/:project_slug/kb                          # overview (repos + docs_present?)
GET  /projects/:project_slug/kb/search?query=...&repo=   # full-text search
GET  /projects/:project_slug/kb/repos/:repo              # repo doc tree
GET  /projects/:project_slug/kb/repos/:repo/pages/*path  # read page (returns content + frontmatter + body)
PUT  /projects/:project_slug/kb/repos/:repo/pages/*path  # create/update page
POST /projects/:project_slug/kb/repos/:repo/move         # move/rename page
POST /projects/:project_slug/kb/repos/:repo/assets       # upload asset (PNG/JPEG/GIF/WebP, ≤4MB)
GET  /projects/:project_slug/kb/repos/:repo/sync         # sync status
POST /projects/:project_slug/kb/repos/:repo/sync         # request sync
```

General (user) KB:

```
GET  /kb                 # overview (connected? + tree)
POST /kb/connect         # clone/provision the personal symphony-kb repo
POST /kb/home            # regenerate the home page (project links)
GET  /kb/search?query=   # full-text search
GET  /kb/pages/*path     # read page
PUT  /kb/pages/*path     # create/update page
```

`:repo` is the `repo_slug` (with `~`). Errors render through
`SymphonyElixirWeb.TrackerErrors` (e.g. `kb_not_connected`, `kb_page_not_found`,
`kb_merge_conflict`).

## Persistence & sync (Git flows)

- UI/tool edits write to a dedicated worktree on the `symphony-docs` branch
  (`<checkout>/.worktrees/symphony-docs`), auto-commit with the Symphony identity,
  and best-effort push. A missing remote does not fail the write.
- Background `SyncWorker` GenServers (under `SyncSupervisor`) run `GitFlow`:
  `sync_branch` (merge the default branch in), `ensure_pull_request`, and
  `evaluate_and_merge` (auto-merge when checks are green). Status is persisted in
  `kb_sync_states` and surfaced via the sync endpoints / `KbSyncBadge`.
- Edits trigger an async sync via `KnowledgeBase.enqueue_sync/2`. In `:test`,
  `kb_sync_on_edit` is disabled so suites stay hermetic.

## Search (FTS5)

- `kb_pages` (metadata) + `kb_pages_fts` virtual table, kept in sync by SQL
  triggers, tokenizer `unicode61 remove_diacritics 2`.
- `KnowledgeBase.search_project/3` and `search_general/2` rank with `bm25` and
  return `snippet` excerpts; both accept an optional `repo_slug` filter.
- `KnowledgeBase.reindex_repo/2` rebuilds a repo's index from disk.

## Core Elixir surface

`SymphonyElixir.KnowledgeBase` is the façade:

- Project: `project_overview/1`, `repo_tree/2`, `read_page/3`, `write_page/4`,
  `move_page/4`, `delete_page/3`, `search_project/3`, `request_sync/2`,
  `sync_status/2`.
- General: `general_connect/0`, `general_overview/0`, `general_read_page/1`,
  `general_write_page/2`, `general_regenerate_home/0`, `search_general/2`.

`write_page` takes `%{frontmatter: map, body: string}` and returns the saved
page; it reindexes and enqueues sync as a side effect.

## Tests

- Shared fixture: `SymphonyElixir.KnowledgeBaseTestFixtures` (required in
  `test_helper.exs`) seeds a project + repositories with a committed `docs/`
  checkout under an isolated workspace root. Use `reset!/0`,
  `seed_single_repo_project/3`, and `add_repo/3`; register the returned
  `:cleanup` with `on_exit/1`.
- Keep KB suites `async: false` (they configure a global workspace root) and
  scope verification to KB files — do not run the full suite.

## Rules

- Treat `docs/*.md` as the source of truth; never invent a separate doc store.
- Always resolve the repository explicitly when a project has more than one repo;
  ask the user rather than guessing.
- Keep page paths valid (`[a-zA-Z0-9._-]`, end in `.md`) and put images in
  `docs/assets/`.
- Search before creating to avoid duplicate pages; sync after editing to publish.
