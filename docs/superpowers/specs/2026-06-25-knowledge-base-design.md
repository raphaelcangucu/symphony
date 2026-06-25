# Git-backed Knowledge Base - Design

> Adds a Notion-like knowledge base to Symphony while keeping Markdown files in
> Git as the source of truth. Project KBs are aggregated from each configured
> repository's `docs/` folder, the user's general KB lives in a private personal
> GitHub repository named `symphony-kb`, and a KB-focused assistant helps create,
> maintain, link, and sync knowledge with the existing project/task workflow.

## 1. Problem

Symphony already has project workspaces, project-scoped assistant chats, issue
management, GitHub/Jira/Linear integration, and background Elixir processes for
long-running orchestration. It does not yet have a first-class place for durable
project knowledge: decisions, onboarding notes, architecture pages, runbooks,
task context, and cross-project references.

The Notion clone reference app provides the desired interaction model: a page
tree, clean document editor, favorites/search/trash, cover/icon metadata, and a
workspace-style navigation experience. Its implementation is not a direct fit:
it uses Convex for reactive persistence, Clerk for auth, Edgestore for assets,
and BlockNote JSON as the durable editor format. Symphony needs the same ease of
use without adopting that backend/runtime model.

The knowledge base should remain friendly to engineers and agents. Markdown in
Git gives readable diffs, reviewable PRs, direct agent access, portability, and
natural co-location with project code. The design should therefore optimize for a
Notion-like UI while preserving Markdown as the project contract.

## 2. Goals

1. Provide a **Notion-like KB UI** inside the tracker: project list links, a page
   tree, document editor, search, and a clean reading/editing surface.
2. Use **Markdown files in Git as the source of truth** for project KB content.
3. Aggregate each project KB from **`docs/` in every repository configured for
   that Symphony project**.
4. Store project assets beside docs in **`docs/assets/`**, referenced by relative
   Markdown links.
5. Create/manage a **general user KB** in a private personal GitHub repo named
   `symphony-kb`.
6. Generate and regenerate a **general KB home page** that links to all configured
   projects and their KBs.
7. Persist UI edits through **auto-commit** on a configurable docs branch, default
   `symphony-docs`.
8. Keep the docs branch synced with the project main/default branch, create/update
   PRs, and auto-merge when checks are green.
9. Run sync, commit, PR, and merge work in **background Elixir jobs with retry**,
   similar to existing long-running Symphony flows.
10. Add a **KB-first assistant chat** that can create/maintain docs, link tasks,
    create tasks from docs, and use existing project management tools.

## 3. Non-goals

- Replacing the existing project board, issue detail, project assistant, or
  authoring assistant.
- Adopting Convex, Clerk, Edgestore, Turso, D1, or R2 for the MVP project KB.
- Building full real-time collaborative editing in the first version.
- Supporting arbitrary external docs providers in the MVP.
- Guaranteeing perfect round-trip support for every Markdown dialect or extension.
- Automatically resolving Git merge conflicts without human review.
- Making Jira attachments the canonical asset store for KB files.

## 4. Decisions

- **D1 - Git/docs is the project KB source of truth.** Project documents live in
  each configured repository under `docs/`. Assets live under `docs/assets/`.
  Symphony may build local indexes/caches for navigation/search, but those are
  derived data.
- **D2 - Aggregate per repo, not one docs repo per project.** A Symphony project
  can span multiple repositories; each repo keeps its own KB in `docs/`, and the
  project KB UI shows a tree grouped by repository to avoid path collisions.
- **D2a - Repository is a first-class KB scope.** Every project KB concept (tree,
  default/home page, page paths, assets, sync state, commits, PRs, and assistant
  tool calls) is scoped by repository. A page is always addressed by
  `(repository, path-within-docs)`, never by a flat project-wide path. The
  project KB has no shared file root across repositories; it is a composition of
  per-repository KBs.
- **D3 - General KB is a personal GitHub repo.** Symphony creates or connects a
  private repo named `symphony-kb` in the authenticated user's personal GitHub
  account. It uses the same docs conventions as project repos.
- **D4 - Use Tiptap with `@tiptap/markdown`.** Tiptap gives stronger Markdown
  compatibility than BlockNote while still allowing a Notion-like editing surface
  through custom UI, extensions, slash commands, and styling.
- **D5 - Metadata lives in frontmatter.** Page metadata such as title, icon, order,
  archived state, favorite state, and generated markers live in YAML frontmatter
  at the top of each Markdown document.
- **D6 - Auto-commit is configurable, default branch `symphony-docs`.** Each repo
  can configure where KB edits are committed. The default is a dedicated
  `symphony-docs` branch to isolate documentation edits from active development
  branches.
- **D7 - Sync and promotion are background flows.** Symphony keeps the docs branch
  updated with the repo's main/default branch, creates or updates a docs PR, and
  auto-merges when checks are green. Conflicts or failed checks become visible
  states requiring human review.
- **D8 - KB assistant is KB-first, not KB-only.** The chat is optimized for
  knowledge operations, but it can use existing project tools to create tasks,
  link tasks, inspect project state, and maintain traceability between docs and
  work items.
- **D9 - Full-text search over a derived SQLite FTS5 index.** Search is full-text
  over page title plus body (not title-only as in the reference clone). The index
  is derived data built from the Git Markdown files using SQLite FTS5, which is
  already available through the project's `ecto_sqlite3`/`exqlite` stack, so no
  new search dependency is introduced. Git remains the source of truth; the index
  is rebuildable at any time and updated incrementally on commit/sync. Every
  indexed row carries its `project`, `repository`, and `path`, so results can be
  scoped/filtered per repository and labeled with their repository.

## 5. File and metadata model

Per-repository docs convention (each repo owns its own `docs/`):

```text
docs/
  index.md
  architecture/
    index.md
    backend.md
    frontend.md
  runbooks/
    deploy.md
  assets/
    architecture-diagram.png
```

Multi-repository project layout. A single Symphony project that spans several
repositories composes their `docs/` trees side by side; there is no merged file
root, only a per-repository grouping:

```text
[project KB]
  repo-1/
    docs/
      index.md
      subfolder-1/
        ...
      subfolder-n/
        ...
  repo-2/
    docs/
      index.md
      subfolder-2/
        ...
      subfolder-n/
        ...
```

### Project KB default/home page

The project KB has a generated default page that acts as the project landing
view. It is not a file inside any single repository's `docs/`; it is a generated
overview the project KB renders that links to each repository's `docs/` root
(its `docs/index.md` when present, otherwise the repository docs root):

- It lists every repository configured for the project.
- For each repository it links to that repository's docs entry page and shows
  its KB/sync status.
- Repositories without a `docs/` folder yet are shown with a "Create first page"
  affordance scoped to that repository.
- It is marked as generated content and can be regenerated; it never overwrites
  user-authored pages inside any repository.

General KB repo convention:

```text
symphony-kb/
  docs/
    index.md
    projects.md
    notes/
      index.md
    assets/
```

Markdown page frontmatter:

```yaml
---
title: Architecture
icon: ":brain:"
order: 10
favorite: false
archived: false
generated: false
symphony:
  page_id: architecture-backend
  source: user
  linked_tasks:
    - CDE-1234
---
```

Rules:

- `title` defaults to the first H1 or filename when missing.
- `order` controls sibling ordering; fallback is path/name ordering.
- `archived: true` hides the page from normal navigation but keeps it in Git.
- `generated: true` identifies pages Symphony can regenerate, such as the general
  KB home page.
- `symphony.page_id` is stable within a repo and helps preserve links when titles
  change.
- Links between pages use relative Markdown links when possible.
- Assets use relative paths into `docs/assets/` or a nested asset folder near the
  page when the implementation chooses that convention for locality.

## 6. User experience

### Project List

- Each project card/list row gets a KB link or CTA.
- If the project has no detected docs yet, the CTA opens an empty KB state with
  "Create first page" and assistant suggestions.
- Multi-repo projects show repository-specific KB status so users can see which
  repos have docs.

### Project KB

- Route shape is project-scoped, for example:
  `/projects/:projectSlug/kb`.
- The KB index route (`/projects/:projectSlug/kb`) renders the generated project
  default/home page that links to each repository's docs root and shows per-repo
  status.
- A page route includes the repository so addressing stays per repository, for
  example `/projects/:projectSlug/kb/:repo/*path`.
- The left sidebar is a per-repository tree. Each repository is a top-level,
  collapsible group, and its `docs/` subfolders and pages nest underneath it:

```text
repo-1  (docs)
  subfolder-1
    page-a
  subfolder-n
repo-2  (docs)
  subfolder-2
  subfolder-n
```

- Repository groups show KB/sync status (synced, pending, conflict, checks
  failed) so the user can tell each repository's state at a glance.
- The main panel renders the selected Markdown document through Tiptap in read or
  edit mode.
- A simple MVP supports headings, paragraphs, links, images, lists, task lists,
  code blocks, blockquotes, tables when stable, and source Markdown fallback.
- Search is full-text over page title and body, served from a derived SQLite FTS5
  index built from every repository's docs. Results are ranked (bm25), can be
  filtered by repository, show a matching snippet, and are labeled with their
  repository.

### General KB

- Route shape can be global, for example `/kb`.
- The first setup creates or connects the user's private GitHub repo
  `symphony-kb`.
- The generated `docs/index.md` links to projects and their KB roots.
- Users can regenerate the home page. Regeneration preserves user-owned pages and
  only rewrites pages marked `generated: true`.

### Assets

- Pasting or uploading an image writes it into the relevant repo under
  `docs/assets/`.
- The editor inserts a relative Markdown image link.
- File type and size validation should reuse the existing attachment validation
  constraints where practical, but the storage target is the repo, not the
  assistant upload workspace.

## 7. Git and background flows

### Auto-commit

When a page is edited:

1. Validate the target project/repo/path.
2. Parse and validate frontmatter.
3. Write the Markdown/asset changes to the correct repository checkout.
4. Stage only the KB files changed by this operation.
5. Commit to the configured docs branch, default `symphony-docs`.
6. Push the docs branch if the repo has a remote.
7. Record job status and surface failures in the KB UI.

Commit messages should be deterministic and scoped, for example:

```text
docs(kb): update architecture overview
```

### Sync with main/default branch

A background worker keeps the docs branch aligned with the repository's default
branch:

1. Fetch remote refs.
2. Ensure `symphony-docs` exists from the default branch when first created.
3. Merge or update from the default branch into `symphony-docs`.
4. If conflicts occur, mark the repo KB sync state as `conflict`.
5. Retry transient Git/network failures with backoff.

### PR and auto-merge

Another worker creates or updates a PR from `symphony-docs` to the default branch:

1. Create the PR if missing.
2. Keep the PR body updated with KB summary/status.
3. Watch checks.
4. Auto-merge when checks are green and branch protection allows it.
5. If checks fail, mark state as `checks_failed` and show it in the UI.

This mirrors existing Symphony behavior for long-running background work: explicit
states, retries, and human-review states instead of hidden failures.

## 8. Backend architecture

Add a knowledge base domain under the Elixir app, with names finalized during
planning. The main boundary should be storage/provider-oriented:

- `KnowledgeBase.ProjectDocs` lists configured repositories and detects `docs/`.
- `KnowledgeBase.MarkdownPage` parses frontmatter/body and validates paths.
- `KnowledgeBase.Indexer` builds local derived data for navigation and full-text
  search. It maintains a `kb_pages` metadata table (project, repository, path,
  page_id, title, content_hash, mtime, archived) and an FTS5 virtual table
  indexing title plus extracted body text, linked by rowid (external-content
  pattern). It rebuilds from files on demand and updates incrementally on
  commit/sync by comparing `content_hash`/`mtime`. Body text is extracted from
  Markdown (frontmatter stripped, markup reduced to plain text) before indexing.
  Queries use FTS5 `MATCH` with `bm25()` ranking and `snippet()` for previews,
  joined against `kb_pages` to filter by project/repository and to exclude
  archived pages.
- `KnowledgeBase.GitWorker` performs write/commit/push/sync work.
- `KnowledgeBase.PullRequestWorker` handles PR creation, check tracking, and
  auto-merge.
- `KnowledgeBase.PersonalRepo` ensures the user's `symphony-kb` repo exists and
  is cloned/available.
- `KnowledgeBase.HomeGenerator` regenerates the general KB home page.
- `KnowledgeBase.AssistantTools` exposes KB-first tool actions to the assistant.

Controllers should follow existing tracker patterns under `/api/tracker/v1`.
Likely endpoints:

- `GET /kb` - general KB tree/status.
- `POST /kb/setup` - ensure/connect `symphony-kb`.
- `POST /kb/home/regenerate` - regenerate general KB home.
- `GET /projects/:project_slug/kb` - project KB overview: repositories, per-repo
  status, and the generated project default/home page.
- `POST /projects/:project_slug/kb/home/regenerate` - regenerate the project
  default/home page that links to each repository's docs.
- `GET /projects/:project_slug/kb/repos/:repo` - one repository's docs tree/status.
- `GET /projects/:project_slug/kb/repos/:repo/pages/*path` - read page.
- `PUT /projects/:project_slug/kb/repos/:repo/pages/*path` - save page.
- `POST /projects/:project_slug/kb/repos/:repo/assets` - upload asset into that
  repository's docs assets.
- `POST /projects/:project_slug/kb/repos/:repo/sync` - enqueue sync/PR flow for a
  repository.
- `GET /projects/:project_slug/kb/search?q=...&repo=...` - full-text search across
  the project's repositories, optionally scoped to one repository, returning
  ranked results with repository label and snippet.
- `GET /kb/search?q=...` - full-text search over the general KB.
- Similar general-KB page/asset endpoints scoped to `/kb`.

Repository identifiers in routes must be a stable, validated slug derived from the
project's configured repositories, never a raw filesystem path.

The exact route names can be refined in the implementation plan to match existing
controller naming conventions.

## 9. Frontend architecture

Add KB routes to the tracker:

- `/kb` for the general user KB.
- `/projects/:projectSlug/kb` for the project KB overview (default/home page).
- `/projects/:projectSlug/kb/:repo/*path` for a page inside a repository.
- Project list cards/rows link to `/projects/:projectSlug/kb`.

The project KB layout always renders a repository-grouped sidebar tree; selecting
a repository expands its `docs/` subfolders and pages.

Suggested modules:

- `tracker/src/services/knowledgeBase.ts` for API calls.
- `tracker/src/hooks/useKnowledgeBaseTree.ts`.
- `tracker/src/pages/KnowledgeBasePage.tsx`.
- `tracker/src/pages/ProjectKnowledgeBasePage.tsx`.
- `tracker/src/components/kb/KbSidebar.tsx` (repository-grouped page tree).
- `tracker/src/components/kb/KbProjectHome.tsx` (generated project default page
  linking to each repository's docs).
- `tracker/src/components/kb/KbEditor.tsx`.
- `tracker/src/components/kb/KbSearch.tsx` (full-text search box; ranked,
  repository-labeled results with snippets).
- `tracker/src/components/kb/KbAssistantPanel.tsx`.
- `tracker/src/components/kb/KbSyncStatus.tsx`.

Editor stack:

- `@tiptap/react`
- `@tiptap/starter-kit`
- `@tiptap/markdown`
- targeted extensions for links, images, task lists, tables, code blocks, and
  slash-menu behavior as needed.

The MVP should include a source Markdown fallback so users can recover if a page
contains Markdown that the rich editor does not fully model.

## 10. KB assistant

The KB assistant is presented like a support chat embedded in the KB surface. It
uses the existing assistant infrastructure where possible, but with a KB-focused
system prompt and tool set.

The assistant is repository-aware. For a multi-repository project it knows the
project is a composition of per-repository docs, and every document tool call
must specify (or be disambiguated to) a target repository. When the target
repository is ambiguous it asks which repository to use instead of guessing, and
it surfaces results grouped by repository.

Initial tool families:

- **Read/search knowledge**: list repositories, list pages in a repository, read
  page by `(repository, path)`, search across repositories with repo-labeled
  results.
- **Maintain docs**: create page, update page, move/rename page, add section,
  link pages, regenerate generated pages (including the project default/home
  page) - all scoped to a repository.
- **Manage assets**: attach image/file to the target repository's docs assets and
  insert a relative Markdown link.
- **Task integration**: create task from selected doc/section, link task to doc
  frontmatter, insert task references into docs, recording the source repository.
- **Project operations**: reuse existing project/issue tools when appropriate.
- **Sync operations**: explain branch/PR state per repository, enqueue sync for a
  repository, surface conflicts and checks status per repository.

The assistant should prefer making small, reviewable doc edits and should surface
the exact repository and files it changed.

## 11. Failure handling

Expected failure states:

- `repo_missing`: configured repo checkout is unavailable.
- `docs_missing`: repo has no `docs/` folder yet.
- `invalid_path`: requested path escapes `docs/` or contains unsafe segments.
- `frontmatter_invalid`: YAML/frontmatter cannot be parsed.
- `editor_roundtrip_risk`: content cannot safely round-trip through rich editor;
  offer source mode.
- `git_dirty_unrelated`: repo has unrelated uncommitted changes.
- `commit_failed`: Git commit failed.
- `push_failed`: remote push failed.
- `sync_conflict`: docs branch cannot merge default branch cleanly.
- `checks_failed`: PR checks failed.
- `automerge_blocked`: branch protection or permissions prevent auto-merge.
- `github_auth_missing`: personal GitHub repo setup cannot proceed.

The UI should show clear actions for each state and avoid destructive Git
operations. Background jobs should retry only transient failures.

## 12. Security and safety

- All file operations must stay under an allowed `docs/` root.
- Never follow symlinks out of the repository/docs root.
- Reject paths with `..`, empty segments, or absolute paths.
- Validate uploaded asset type/size.
- Auto-commit must stage only files changed by the KB operation.
- If unrelated dirty working tree changes exist, fail fast or isolate with a
  dedicated worktree, depending on the implementation plan.
- Personal repo creation uses the authenticated GitHub user and creates a private
  repo by default.
- No secrets are written into Markdown/frontmatter.

## 13. MVP scope

Recommended MVP:

1. Detect each project repository's `docs/` folder and show project-list KB links.
2. Render a repository-grouped sidebar tree for the project KB.
3. Generate the project default/home page linking to every repository's docs.
4. Create/connect personal `symphony-kb` repo.
5. Generate general KB home page with project links.
6. Render and edit Markdown pages with Tiptap, addressed by `(repository, path)`.
7. Upload/paste images into the target repository's `docs/assets/` and insert
   relative links.
8. Auto-commit to the configured docs branch per repository, default
   `symphony-docs`.
9. Basic background sync + PR creation per repository.
10. Manual conflict/check failure status in UI, per repository.
11. Full-text search (title + body) via a derived SQLite FTS5 index, scoped and
    labeled by repository.
12. Repository-aware KB assistant read/search/create/update page tools.

Defer:

- Advanced block-level drag/drop.
- Full Notion-style database/table views.
- Real-time collaborative editing.
- Automatic semantic reorganization of entire KBs.
- Complex bidirectional task graph visualizations.

## 14. Testing and validation

Backend:

- Path validation for project docs and personal KB docs.
- Frontmatter parse/serialize round trips.
- Tree/index generation across multiple repos with colliding filenames.
- Full-text indexing: body extraction strips frontmatter/markup; FTS5 row stays in
  sync on create/update/move/delete; incremental update via content_hash/mtime;
  full rebuild reproduces the same index.
- Search query: matches title and body, ranks with bm25, returns snippets, filters
  by repository, and excludes archived pages.
- Auto-commit stages only KB files.
- Dirty working tree protection.
- Sync worker retry and conflict states.
- PR worker create/update/automerge state transitions.
- Personal repo setup with mocked GitHub API/client.
- Assistant tools for read/create/update/link task.

Frontend:

- Project list renders KB link/CTA.
- Project KB sidebar groups pages by repository and nests subfolders.
- Project default/home page lists each repository and links to its docs.
- Page addressing by `(repository, path)` resolves to the correct repository.
- General KB setup and generated home state.
- Full-text search returns ranked, repository-labeled results with snippets and
  supports filtering by repository.
- Tiptap editor loads Markdown and saves Markdown.
- Source-mode fallback for risky content.
- Asset upload inserts relative Markdown link.
- Sync status banners for pending/conflict/checks failed.
- KB assistant invokes document tools and reflects changed files.

Manual/e2e:

- Create a page, edit it, auto-commit to `symphony-docs`, push, create PR, and
  auto-merge after checks.
- Regenerate `symphony-kb/docs/index.md` and verify project links.
- Multi-repo project with docs in two repos and same page names.

## 15. Open decisions for implementation planning

- Whether KB writes should use the existing project checkout or a dedicated
  per-repo docs worktree to avoid dirty working tree conflicts.
- Exact branch sync strategy: merge default into `symphony-docs` vs rebase. The
  design favors merge for safety and auditability.
- Whether `symphony-kb` should be cloned under the existing workspace root or a
  dedicated user-KB root.
- Exact route naming and controller/module names.
- Minimum supported Markdown extensions for the first Tiptap editor pass.
- FTS5 tokenizer choice (for example `unicode61` with diacritics folding vs
  `porter` vs `trigram`) and whether prefix/substring matching is needed.
- Whether the FTS5 index lives in the main app database or a dedicated KB database
  file, given it is fully derived/rebuildable.
