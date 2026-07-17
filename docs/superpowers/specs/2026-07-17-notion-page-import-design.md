# Notion page/database import — markdown + assets for the assistant

**Date:** 2026-07-17  
**Status:** Approved (implementation)  
**Surfaces:** Elixir Notion client + Importer, Settings → Providers credentials,
assistant tool `import_notion_page`, tracker HTTP import endpoint, assistant
composer Notion URL shortcut, `NotionImportCard` + side Sheet preview, project
skill under `skills/notion/`  
**Related:** Linear credentials/tool pattern (`Settings.Credentials`,
`linear_graphql`); assistant cards (`CreatePlanCard`); `mix symphony.tool`

## 1. Problem

Operators and agents often need the content of a Notion page or database (e.g.
game design / backend task docs with images) inside Symphony so the assistant
can turn it into issues, KB pages, or other work. Today there is no first-class
Notion integration: no credential storage, no import tool, and no chat UI to
preview what was pulled.

## 2. Goals (v1)

1. Configure a **global** Notion Integration Token in Settings → Providers
   (same vault pattern as Linear), with `NOTION_API_KEY` env fallback.
2. Given a Notion **page or database URL**, download a Markdown representation
   plus local asset files under a **temporary** directory.
3. Expose the same import path to:
   - the assistant via tool `import_notion_page`
   - the user via a **composer shortcut** when a Notion URL is pasted/sent
4. Show an **import card** in the assistant chat; clicking it opens a **side
   Sheet** with a read-only Markdown preview (and asset list).
5. Leave next steps to the agent/user (create issue, write KB, etc.) — do **not**
   auto-persist into the repo or KB.

## 3. Non-goals (v1)

- Per-project Notion credentials or workspace overrides
- Bidirectional sync / watch / write-back to Notion
- High-fidelity conversion of every Notion block (toggles, synced blocks,
  complex embeds, full child-page expansion for every database row)
- Magic Command Palette entry as a separate product surface (composer + tool
  are enough for v1)
- Guaranteed long-term retention of `/tmp` imports (cleanup TTL may be added
  later; v1 documents “temporary”)

## 4. Decisions

| Topic | Choice |
| --- | --- |
| Credential scope | Global (`Settings.Credentials` provider `notion`) |
| Storage | `/tmp/symphony-notion/<import_id>/` |
| Content kinds | Pages **and** databases |
| Triggers | Assistant tool **and** composer shortcut (both call the same Importer) |
| UI | Chat `NotionImportCard` → side Sheet Markdown preview |
| Post-import | Agent/user decides (issue, KB, …) |

## 5. Architecture

```text
Notion URL
  → Composer shortcut  OR  tool `import_notion_page`
  → HTTP/tool handler
  → SymphonyElixir.Notion.Importer
       ├─ SymphonyElixir.Notion.Config (Credentials + NOTION_API_KEY)
       ├─ SymphonyElixir.Notion.Client (REST API via Req)
       ├─ URL → page_id | database_id
       ├─ Blocks / DB query → Markdown
       └─ File/image URLs → assets/
  → Structured result
  → Chat: NotionImportCard
  → Click: Sheet with Markdown + asset paths
```

### 5.1 Modules (Elixir)

| Module | Responsibility |
| --- | --- |
| `SymphonyElixir.Notion.Config` | Resolve API key (Credentials → env) |
| `SymphonyElixir.Notion.Client` | Notion REST: retrieve page/database, list block children, query DB, download files |
| `SymphonyElixir.Notion.Url` | Parse `notion.so` URLs (with/without hyphens in id; `?v=` / `&p=` page-in-DB views) |
| `SymphonyElixir.Notion.Markdown` | Block → Markdown; database rows → Markdown table |
| `SymphonyElixir.Notion.Importer` | Orchestrate fetch → write `/tmp` → return result map |

Prefer `Req` (existing HTTP client style in the codebase).

### 5.2 On-disk layout

```text
/tmp/symphony-notion/<import_id>/
  page.md          # primary markdown
  meta.json        # source_url, notion_id, kind, title, imported_at, asset_count, warnings
  assets/          # downloaded images/files; relative links from page.md
```

`import_id` is a new opaque id (UUID) generated per import, not the Notion id
alone (allows re-imports without collision).

## 6. Credentials

Extend `SymphonyElixir.Settings.Credentials` `@fields`:

```elixir
"notion" => [
  %{key: "api_key", label: "Integration token", secret: true}
]
```

Resolution order (mirror Linear):

1. Stored vault value for `notion` / `api_key`
2. Else `NOTION_API_KEY` env
3. Else unset → import fails with actionable error

UI: existing Providers credentials card picks up the new provider automatically
once the field schema is registered (plus i18n labels).

**Operator prerequisite:** the Notion Integration must be invited/shared on the
target page or database; otherwise Notion returns 403.

Document in `.env.example`: `NOTION_API_KEY=`.

## 7. URL parsing

Accept common browser URLs, including workspace-prefixed and view/page query
params, e.g.:

- `https://www.notion.so/<workspace>/<title>-<32hex>`
- `https://www.notion.so/<32hex>`
- URLs with `?v=<viewId>&p=<pageId>&pm=s` (page opened from a database view):
  prefer the **page** id from `p=` when present; otherwise treat as database/page
  id from the path.

Normalize 32-hex ids to UUID form with hyphens for the Notion API.

If both a database view and an embedded page id appear, import the **focused
page** (`p=`) when present; otherwise use the path id and resolve
page-vs-database via the Notion API (see §9.2).

## 8. Conversion rules

### 8.1 Pages

Supported blocks (v1):

- Title (page properties / first heading)
- Headings (1–3), paragraphs
- Bulleted / numbered lists, to-do items
- Code (inline + fenced blocks with language when available)
- Quotes, dividers
- Images and files → download into `assets/`, rewrite to relative Markdown links
- Simple bookmarks / external links as Markdown links

Unsupported blocks: emit an HTML comment placeholder, e.g.
`<!-- unsupported notion block: toggle -->`, and continue. Do not fail the whole
import.

Child pages / linked pages: render as a Markdown link with title; do **not**
recursively import bodies in v1.

### 8.2 Databases

1. Retrieve database metadata (title, properties).
2. Query rows with pagination; **hard cap 100 rows** in v1 (configurable constant).
3. Emit a Markdown table: one column per property (stable property order from
   the schema); cell values stringified (select, multi-select, people, dates,
   relations as readable text; files as links when downloadable).
4. Optionally append a short “Rows” section listing page titles + Notion URLs.
5. Do **not** expand each row’s page body by default.
6. If truncated by the row cap, set `warnings` in `meta.json` and surface on the
   card.

## 9. API / tool contract

### 9.1 Assistant tool: `import_notion_page`

**Input:**

```json
{
  "url": "https://www.notion.so/..."
}
```

Optional later: `include_page_bodies` (out of v1 default path).

**Success data (shape):**

```json
{
  "import_id": "…",
  "title": "Marble Race — Backend Task Doc",
  "kind": "page",
  "source_url": "https://www.notion.so/…",
  "markdown_path": "/tmp/symphony-notion/<id>/page.md",
  "assets_dir": "/tmp/symphony-notion/<id>/assets",
  "meta_path": "/tmp/symphony-notion/<id>/meta.json",
  "asset_count": 1,
  "warnings": [],
  "preview_markdown": "first ~2KB for card/snippet"
}
```

Register in `ToolExecutor` like other assistant tools; available via
`mix symphony.tool call import_notion_page --url …`.

### 9.2 Tracker HTTP

Under the existing `/api/tracker/v1` API pipeline:

- `POST /api/tracker/v1/notion/import` with body `{ "url": "…" }`
  (global credential; project slug optional in body/header only if needed for
  chat association — import itself is not project-scoped).
- `GET /api/tracker/v1/notion/imports/:import_id` — returns meta + full
  markdown text (+ asset listing) for the Sheet preview. Reads only from the
  daemon-local `/tmp/symphony-notion/<import_id>/` tree; auth same as other
  tracker APIs.

Composer and tool share `Notion.Importer`; HTTP is the composer’s entry point.

**Kind detection:** after parsing an id, call Notion retrieve page; if that
fails as “not a page”, retrieve database (or inspect object type from the API
error/`object` field). Persist `kind` in `meta.json`.

## 10. Tracker UI

### 10.1 Composer shortcut

When the user pastes or submits text containing a Notion URL:

- Show a lightweight confirm chip/action: **Import from Notion** (do **not**
  auto-import on every paste — avoids surprise network calls and 403 noise).
- On confirm, call the HTTP import endpoint.
- On success, render a `NotionImportCard` in the thread (same payload shape as
  the tool result). The URL may remain in the message text; the card is the
  structured artifact.
- If credentials are missing, show the clear error and hint to
  Settings → Providers.

### 10.2 `NotionImportCard`

Inspired by `CreatePlanCard`:

- Title, kind badge (`page` / `database`), asset count, truncated preview
- Primary action: **Open preview** → opens side Sheet
- Secondary (optional v1): copy markdown path for the agent

### 10.3 Side Sheet preview

- Read-only Markdown render of `page.md` (fetch via GET import endpoint)
- List of assets with filenames (and paths under `/tmp/…`)
- No edit/save-to-KB in the Sheet for v1 (agent/tools handle persistence)

Wire into `ProjectAssistantPanel` alongside existing Sheet usage.

## 11. Skill and commands

Add project skill `skills/notion/SKILL.md` (synced to `.claude` / `.codex` per
repo skill layout):

- When to use: user pastes Notion URL, asks to pull Notion content, needs MD/assets
- Prefer tool `import_notion_page` (or `mix symphony.tool` when MCP tools absent)
- Credential setup pointer
- Instruct: treat `/tmp` as temporary; propose KB/issue only when the user wants
- Do not invent content if import fails

No separate Magic Command Palette command required in v1; composer + tool cover
“commands”.

## 12. Errors

| Case | Behavior |
| --- | --- |
| Missing API key | Error naming Providers + `NOTION_API_KEY` |
| Not shared with Integration | 403-style message: share the page/DB with the Integration |
| Unparseable URL | 400 with parse hint |
| Notion rate limit / 5xx | Retry lightly where safe; else surface error |
| DB over row cap | Partial import + `warnings` on card/meta |
| Asset download failure | Keep MD with remote URL or placeholder; warn in meta |

## 13. Testing

- Unit: URL parser (hyphenated / bare hex / `p=` query)
- Unit: Markdown converter fixtures for common blocks + one database table
- Unit: Credentials resolution (vault vs env)
- Controller/tool: import happy path with mocked Notion HTTP
- Tracker: `NotionImportCard` opens Sheet; composer Notion URL path (narrow tests)

Follow WSL rule: one narrowly targeted test file/filter at a time.

## 14. Rollout / docs

- `.env.example`: `NOTION_API_KEY`
- Elixir README short “Notion import” note (credential + tool name)
- Skill as operator/agent docs

## 15. Future (explicitly later)

- Per-project token override
- `include_page_bodies` for database rows
- Richer block support (toggle, callout, synced blocks)
- TTL sweeper for `/tmp/symphony-notion`
- Optional “Save to KB” button on the Sheet
- Magic palette command
