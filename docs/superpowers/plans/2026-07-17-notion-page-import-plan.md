# Notion Page/Database Import — Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task.
>
> **WSL:** Never run full/batch/parallel/directory-wide test suites. Run **one** targeted ExUnit file/`--only` filter or **one** Vitest file/`-t` filter at a time, sequentially. Ask before expanding scope.

**Goal:** Pull a Notion page or database by URL into temporary Markdown + assets under `/tmp`, expose it via credentials, assistant tool, tracker HTTP, composer confirm chip, import card + side Sheet preview, and a project skill.

**Architecture:** Elixir `SymphonyElixir.Notion.*` owns URL parse, REST client (Req), block/DB → Markdown, and Importer writing `/tmp/symphony-notion/<import_id>/`. Global Integration Token via `Settings.Credentials` + `NOTION_API_KEY`. Same Importer backs tool `import_notion_page` and `POST /api/tracker/v1/notion/import`. Tracker renders `NotionImportCard` and a Sheet that `GET`s the import for Markdown preview.

**Tech Stack:** Elixir/Phoenix, Req, ExUnit; React/TypeScript, Vitest, existing `Markdown` + Sheet UI, i18next.

**Spec:** [`../specs/2026-07-17-notion-page-import-design.md`](../specs/2026-07-17-notion-page-import-design.md)

---

## File map

| Path | Role |
|------|------|
| `elixir/lib/symphony_elixir/settings/credentials.ex` | Add `notion` / `api_key` field |
| `elixir/lib/symphony_elixir/notion/config.ex` | Resolve API key (vault → env) |
| `elixir/lib/symphony_elixir/notion/url.ex` | Parse Notion URLs → `{id, hint}` |
| `elixir/lib/symphony_elixir/notion/client.ex` | Notion REST (pages, blocks, databases, file download) |
| `elixir/lib/symphony_elixir/notion/markdown.ex` | Blocks + DB rows → Markdown string + asset jobs |
| `elixir/lib/symphony_elixir/notion/importer.ex` | Orchestrate → `/tmp` layout → result map |
| `elixir/lib/symphony_elixir/assistant/notion_tools.ex` | Tool spec + `execute/3` |
| `elixir/lib/symphony_elixir/assistant/tool_executor.ex` | Register Notion tools (project + freeform) |
| `elixir/lib/symphony_elixir_web/controllers/tracker/notion_controller.ex` | `import` + `show` |
| `elixir/lib/symphony_elixir_web/controllers/tracker/credentials_controller.ex` | Label + `effective_value` for notion |
| `elixir/lib/symphony_elixir_web/router.ex` | Routes under `/api/tracker/v1` |
| `elixir/test/symphony_elixir/notion/*_test.exs` | Unit tests |
| `elixir/test/symphony_elixir_web/controllers/tracker/notion_controller_test.exs` | HTTP tests |
| `elixir/test/symphony_elixir/settings/credentials_test.exs` | Notion credential field |
| `elixir/.env.example` | `NOTION_API_KEY=` |
| `tracker/src/services/notion.ts` | HTTP client for import/show |
| `tracker/src/lib/notionUrl.ts` | Detect Notion URLs in text |
| `tracker/src/components/assistant/NotionImportCard.tsx` | Card UI |
| `tracker/src/components/assistant/NotionImportPreviewSheet.tsx` | Sheet + Markdown |
| `tracker/src/components/assistant/AssistantComposer.tsx` | Confirm chip |
| `tracker/src/components/assistant/ProjectAssistantPanel.tsx` | Wire card + sheet |
| `tracker/locales/en/tracker.json` + `pt-BR/tracker.json` | Copy |
| `skills/notion/SKILL.md` | Agent skill |
| `skills/README.md` | List `notion/` |
| `elixir/README.md` | Short Notion note |

---

### Task 1: Notion credential field + Config

**Files:**
- Modify: `elixir/lib/symphony_elixir/settings/credentials.ex`
- Create: `elixir/lib/symphony_elixir/notion/config.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/credentials_controller.ex`
- Modify: `elixir/test/symphony_elixir/settings/credentials_test.exs`
- Create: `elixir/test/symphony_elixir/notion/config_test.exs`
- Modify: `elixir/.env.example`

- [ ] **Step 1: Write the failing credential test**

Add to `credentials_test.exs`:

```elixir
test "notion integration token is a known encrypted credential" do
  assert Credentials.field?("notion", "api_key")
  assert Credentials.secret_field?("notion", "api_key")

  assert {:ok, :stored} = Credentials.put("notion", "api_key", "secret_notion_token")
  assert Credentials.get("notion", "api_key") == "secret_notion_token"
end
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `elixir/`):

```bash
mise exec -- mix test test/symphony_elixir/settings/credentials_test.exs --only line:<line_of_new_test>
```

Or filter by name if using `@tag`:

```bash
mise exec -- mix test test/symphony_elixir/settings/credentials_test.exs -i "notion integration"
```

Expected: FAIL — `field?("notion", …)` false / put unknown.

- [ ] **Step 3: Add credential field + Config + controller wiring**

In `credentials.ex` `@fields`, add:

```elixir
"notion" => [
  %{key: "api_key", label: "Integration token", secret: true}
]
```

Create `config.ex`:

```elixir
defmodule SymphonyElixir.Notion.Config do
  @moduledoc false

  alias SymphonyElixir.Settings.Credentials

  @spec api_key() :: String.t() | nil
  def api_key do
    case Credentials.get("notion", "api_key") do
      value when is_binary(value) ->
        normalize(value)

      _ ->
        System.get_env("NOTION_API_KEY") |> normalize()
    end
  end

  defp normalize(nil), do: nil
  defp normalize(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end
end
```

In `credentials_controller.ex`:
- Add `"notion" => "Notion"` to `@provider_labels`
- Alias `SymphonyElixir.Notion.Config, as: NotionConfig`
- Add `defp effective_value("notion", "api_key"), do: NotionConfig.api_key()`

Append to `elixir/.env.example` (near other provider tokens):

```bash
# --- Notion import ---------------------------------------------------------
# Integration token for import_notion_page / Settings → Providers → Notion.
NOTION_API_KEY=
```

- [ ] **Step 4: Write Config test + run both**

`config_test.exs`:

```elixir
defmodule SymphonyElixir.Notion.ConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Notion.Config
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.{Credentials, Setting}

  setup do
    Repo.delete_all(Setting)
    previous = System.get_env("NOTION_API_KEY")
    on_exit(fn ->
      Repo.delete_all(Setting)
      if previous, do: System.put_env("NOTION_API_KEY", previous), else: System.delete_env("NOTION_API_KEY")
    end)
    System.delete_env("NOTION_API_KEY")
    :ok
  end

  test "prefers stored credential over env" do
    System.put_env("NOTION_API_KEY", "env-key")
    assert Config.api_key() == "env-key"
    assert {:ok, :stored} = Credentials.put("notion", "api_key", "db-key")
    assert Config.api_key() == "db-key"
  end
end
```

Run:

```bash
mise exec -- mix test test/symphony_elixir/notion/config_test.exs
```

Expected: PASS.

Then:

```bash
mise exec -- mix test test/symphony_elixir/settings/credentials_test.exs -i "notion integration"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/settings/credentials.ex \
  elixir/lib/symphony_elixir/notion/config.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/credentials_controller.ex \
  elixir/test/symphony_elixir/settings/credentials_test.exs \
  elixir/test/symphony_elixir/notion/config_test.exs \
  elixir/.env.example
git commit -m "$(cat <<'EOF'
feat(notion): add global Integration token credential

EOF
)"
```

---

### Task 2: URL parser

**Files:**
- Create: `elixir/lib/symphony_elixir/notion/url.ex`
- Create: `elixir/test/symphony_elixir/notion/url_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Notion.UrlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Notion.Url

  test "parses hyphenated UUID in path" do
    assert {:ok, %{id: "39c33f2e-afc1-4020-ac9b-c223b4520d17", focused_page_id: nil}} =
             Url.parse(
               "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17"
             )
  end

  test "parses 32-hex suffix after title slug" do
    assert {:ok, %{id: "ba15679b-2eb3-4182-a336-57d314df88e0", focused_page_id: nil}} =
             Url.parse(
               "https://www.notion.so/gambalabs/Gamba-Tasks-ba15679b2eb34182a33657d314df88e0"
             )
  end

  test "prefers p= query as focused page id" do
    url =
      "https://www.notion.so/p/gambalabs/ba15679b2eb34182a33657d314df88e0" <>
        "?v=972633e9a0504d53bca2a99289003bd7&p=39c33f2eafc14020ac9bc223b4520d17&pm=s"

    assert {:ok,
            %{
              id: "ba15679b-2eb3-4182-a336-57d314df88e0",
              focused_page_id: "39c33f2e-afc1-4020-ac9b-c223b4520d17"
            }} = Url.parse(url)
  end

  test "rejects non-notion hosts" do
    assert {:error, :invalid_notion_url} = Url.parse("https://example.com/foo")
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir/notion/url_test.exs
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `Url.parse/1`**

```elixir
defmodule SymphonyElixir.Notion.Url do
  @moduledoc false

  @hex32 ~r/([0-9a-fA-F]{32})/

  @spec parse(String.t()) ::
          {:ok, %{id: String.t(), focused_page_id: String.t() | nil}} | {:error, :invalid_notion_url}
  def parse(url) when is_binary(url) do
    uri = URI.parse(String.trim(url))

    with true <- notion_host?(uri.host),
         {:ok, path_id} <- path_id(uri.path) do
      focused =
        case uri.query do
          q when is_binary(q) ->
            q |> URI.decode_query() |> Map.get("p") |> normalize_id()

          _ ->
            nil
        end

      {:ok, %{id: path_id, focused_page_id: focused}}
    else
      _ -> {:error, :invalid_notion_url}
    end
  end

  def parse(_), do: {:error, :invalid_notion_url}

  defp notion_host?(host) when is_binary(host) do
    host in ["notion.so", "www.notion.so"] or String.ends_with?(host, ".notion.site")
  end

  defp notion_host?(_), do: false

  defp path_id(path) when is_binary(path) do
    case Regex.scan(@hex32, path) |> List.last() do
      [_, hex] -> {:ok, to_uuid(hex)}
      _ -> :error
    end
  end

  defp path_id(_), do: :error

  defp normalize_id(nil), do: nil
  defp normalize_id(value) when is_binary(value) do
    hex = value |> String.replace("-", "") |> String.downcase()
    if String.match?(hex, ~r/^[0-9a-f]{32}$/), do: to_uuid(hex), else: nil
  end

  defp to_uuid(<<a::binary-size(8), b::binary-size(4), c::binary-size(4), d::binary-size(4), e::binary-size(12)>>) do
    "#{a}-#{b}-#{c}-#{d}-#{e}" |> String.downcase()
  end
end
```

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir/notion/url_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/notion/url.ex elixir/test/symphony_elixir/notion/url_test.exs
git commit -m "$(cat <<'EOF'
feat(notion): parse page and database URLs

EOF
)"
```

---

### Task 3: Markdown converter (pages + database tables)

**Files:**
- Create: `elixir/lib/symphony_elixir/notion/markdown.ex`
- Create: `elixir/test/symphony_elixir/notion/markdown_test.exs`

- [ ] **Step 1: Write failing tests** (fixture maps shaped like Notion API blocks/pages)

```elixir
defmodule SymphonyElixir.Notion.MarkdownTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Notion.Markdown

  test "renders heading paragraph list and code" do
    blocks = [
      %{
        "type" => "heading_1",
        "heading_1" => %{"rich_text" => [%{"plain_text" => "Title", "annotations" => %{}}]}
      },
      %{
        "type" => "paragraph",
        "paragraph" => %{
          "rich_text" => [
            %{"plain_text" => "Hello ", "annotations" => %{}},
            %{"plain_text" => "code", "annotations" => %{"code" => true}}
          ]
        }
      },
      %{
        "type" => "bulleted_list_item",
        "bulleted_list_item" => %{"rich_text" => [%{"plain_text" => "Item", "annotations" => %{}}]}
      },
      %{
        "type" => "code",
        "code" => %{
          "language" => "elixir",
          "rich_text" => [%{"plain_text" => "1 + 1", "annotations" => %{}}]
        }
      }
    ]

    {md, assets} = Markdown.from_blocks(blocks, "Page Title")
    assert md =~ "# Page Title"
    assert md =~ "# Title" or md =~ "## Title" or md =~ "Title"
    assert md =~ "`code`"
    assert md =~ "- Item"
    assert md =~ "```elixir"
    assert assets == []
  end

  test "queues image assets and rewrites relative path" do
    blocks = [
      %{
        "id" => "img1",
        "type" => "image",
        "image" => %{
          "type" => "external",
          "external" => %{"url" => "https://example.com/a.png"}
        }
      }
    ]

    {md, assets} = Markdown.from_blocks(blocks, "Img")
    assert [%{url: "https://example.com/a.png", filename: filename}] = assets
    assert md =~ "./assets/#{filename}"
  end

  test "database rows become a markdown table" do
    properties_schema = [
      {"Name", "title"},
      {"Status", "select"}
    ]

    rows = [
      %{
        "url" => "https://www.notion.so/row1",
        "properties" => %{
          "Name" => %{"type" => "title", "title" => [%{"plain_text" => "Alpha"}]},
          "Status" => %{"type" => "select", "select" => %{"name" => "Done"}}
        }
      }
    ]

    md = Markdown.from_database("DB", properties_schema, rows)
    assert md =~ "# DB"
    assert md =~ "| Name | Status |"
    assert md =~ "| Alpha | Done |"
  end

  test "unsupported blocks become HTML comments" do
    blocks = [%{"type" => "toggle", "toggle" => %{"rich_text" => []}}]
    {md, _} = Markdown.from_blocks(blocks, "T")
    assert md =~ "<!-- unsupported notion block: toggle -->"
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir/notion/markdown_test.exs
```

- [ ] **Step 3: Implement `Markdown`**

Public API:

```elixir
@spec from_blocks([map()], String.t()) :: {String.t(), [map()]}
@spec from_database(String.t(), [{String.t(), String.t()}], [map()]) :: String.t()
```

Implement rich_text annotations (`code`, `bold`, `italic`, links), list markers, to-do (`- [ ]` / `- [x]`), quote (`>`), divider (`---`), image/file asset jobs `%{url, filename, block_id}`, bookmark as `[name](url)`, child_page as link stub, unsupported as comment.

Filename: sanitize from URL path or `block-<id>.<ext>`; default `.png`/`.bin` when unknown.

Property stringify for DB: title, rich_text, select, multi_select, number, checkbox, url, email, phone, date, people, files, relation, status, formula (as string via `string`/`number`/`boolean` when present).

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir/notion/markdown_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/notion/markdown.ex elixir/test/symphony_elixir/notion/markdown_test.exs
git commit -m "$(cat <<'EOF'
feat(notion): convert blocks and databases to markdown

EOF
)"
```

---

### Task 4: Notion Client (Req) with injectable HTTP

**Files:**
- Create: `elixir/lib/symphony_elixir/notion/client.ex`
- Create: `elixir/test/symphony_elixir/notion/client_test.exs`

- [ ] **Step 1: Write failing test using a Bypass or stub module**

Prefer a `http` option that is a function `(method, url, opts) -> {:ok, status, body} | {:error, term}` so tests never hit the network:

```elixir
test "retrieve_page returns decoded map" do
  http = fn :get, url, _opts ->
    assert url =~ "/v1/pages/"
    {:ok, 200, %{"object" => "page", "id" => "39c33f2e-afc1-4020-ac9b-c223b4520d17"}}
  end

  assert {:ok, %{"object" => "page"}} =
           Client.retrieve_page("39c33f2e-afc1-4020-ac9b-c223b4520d17", api_key: "k", http: http)
end

test "maps 401 to unauthorized" do
  http = fn :get, _url, _opts -> {:ok, 401, %{"message" => "Invalid"}} end
  assert {:error, :unauthorized} = Client.retrieve_page("x", api_key: "bad", http: http)
end
```

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir/notion/client_test.exs
```

- [ ] **Step 3: Implement Client**

Base URL `https://api.notion.com`. Headers:

- `Authorization: Bearer <key>`
- `Notion-Version: 2022-06-28`
- `Content-Type: application/json`

Functions:

- `retrieve_page/2`, `retrieve_database/2`
- `list_block_children/2` — paginate `start_cursor` until done (cap pages e.g. 50)
- `query_database/2` — paginate; stop at **100** rows total (`@max_database_rows 100`)
- `download/2` — GET binary for asset URL (no Notion-Version required for S3 signed URLs)

Default `http` uses `Req.request/1`. Error mapping: 401 → `:unauthorized`, 403 → `:forbidden`, 404 → `:not_found`, other → `{:http_error, status, body}`.

Missing `api_key` → `{:error, :missing_api_key}` before HTTP.

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir/notion/client_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/notion/client.ex elixir/test/symphony_elixir/notion/client_test.exs
git commit -m "$(cat <<'EOF'
feat(notion): add REST client with injectable HTTP

EOF
)"
```

---

### Task 5: Importer (write `/tmp` + result map)

**Files:**
- Create: `elixir/lib/symphony_elixir/notion/importer.ex`
- Create: `elixir/test/symphony_elixir/notion/importer_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
test "imports a page into tmp and returns paths" do
  http = fn
    :get, url, _ when url =~ "/v1/pages/" ->
      {:ok, 200,
       %{
         "object" => "page",
         "id" => "39c33f2e-afc1-4020-ac9b-c223b4520d17",
         "properties" => %{
           "title" => %{"type" => "title", "title" => [%{"plain_text" => "Marble Race"}]}
         },
         "url" => "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17"
       }}

    :get, url, _ when url =~ "/v1/blocks/" ->
      {:ok, 200,
       %{
         "results" => [
           %{
             "type" => "paragraph",
             "paragraph" => %{"rich_text" => [%{"plain_text" => "Hello", "annotations" => %{}}]}
           }
         ],
         "has_more" => false
       }}
  end

  assert {:ok, result} =
           Importer.import_url(
             "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17",
             api_key: "k",
             http: http
           )

  assert result.kind == "page"
  assert result.title =~ "Marble"
  assert File.exists?(result.markdown_path)
  assert File.exists?(result.meta_path)
  assert File.read!(result.markdown_path) =~ "Hello"
end

test "uses focused_page_id from p= when present" do
  focused = "39c33f2e-afc1-4020-ac9b-c223b4520d17"
  db = "ba15679b-2eb3-4182-a336-57d314df88e0"

  http = fn
    :get, url, _ when url =~ focused ->
      {:ok, 200,
       %{
         "object" => "page",
         "id" => focused,
         "properties" => %{
           "title" => %{"type" => "title", "title" => [%{"plain_text" => "Focused"}]}
         },
         "url" => "https://www.notion.so/#{String.replace(focused, "-", "")}"
       }}

    :get, url, _ when url =~ "/v1/blocks/" <> focused or url =~ "/v1/blocks/#{focused}" ->
      {:ok, 200, %{"results" => [], "has_more" => false}}

    :get, url, _ ->
      flunk("unexpected request: #{url} (db id #{db} must not be fetched as page body)")
  end

  url =
    "https://www.notion.so/p/ws/#{String.replace(db, "-", "")}" <>
      "?p=#{String.replace(focused, "-", "")}"

  assert {:ok, result} = Importer.import_url(url, api_key: "k", http: http)
  assert result.title == "Focused"
  assert result.kind == "page"
end
```

Also test missing key → `{:error, :missing_api_key}` and invalid URL → `{:error, :invalid_notion_url}`.

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir/notion/importer_test.exs
```

- [ ] **Step 3: Implement Importer**

```elixir
@spec import_url(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
```

Algorithm:

1. `Config.api_key()` unless `opts[:api_key]`
2. `Url.parse/1` → if `focused_page_id`, target that id first as page
3. Else try `retrieve_page(id)`; on `:not_found`/wrong object try `retrieve_database(id)`
4. Page path: list all block children (recurse into blocks with `has_children` for lists/toggles that need children — for unsupported parents still list children if `has_children` is true for lists only; YAGNI: recurse one level for `bulleted_list_item` / `numbered_list_item` / `to_do` / `column_list` if needed; otherwise flat list is OK for v1)
5. `Markdown.from_blocks/2` → write assets via `Client.download/2` into `assets/`
6. Database path: query ≤100 rows → `Markdown.from_database/3`; `warnings` if truncated
7. Write `page.md`, `meta.json`, return result map per spec §9.1 (`import_id`, paths, `preview_markdown` = first 2048 bytes, `warnings`)

Root dir: `System.tmp_dir!() |> Path.join("symphony-notion") |> Path.join(import_id)`.

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir/notion/importer_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/notion/importer.ex elixir/test/symphony_elixir/notion/importer_test.exs
git commit -m "$(cat <<'EOF'
feat(notion): import pages and databases to /tmp markdown

EOF
)"
```

---

### Task 6: Assistant tool `import_notion_page`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/notion_tools.ex`
- Create: `elixir/test/symphony_elixir/assistant/notion_tools_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`

- [ ] **Step 1: Write failing tool test**

`NotionTools` calls `Importer.import_url/1` (no HTTP injection at the tool layer). Cover error paths only; happy path stays in `importer_test.exs`.

```elixir
test "missing api key" do
  # ensure Credentials cleared and NOTION_API_KEY unset in setup
  assert {:error, :missing_api_key} =
           NotionTools.execute(
             "import_notion_page",
             %{"url" => "https://www.notion.so/" <> String.duplicate("a", 32)},
             []
           )
end

test "invalid url with key configured" do
  assert {:ok, :stored} = Credentials.put("notion", "api_key", "tok")
  assert {:error, :invalid_notion_url} =
           NotionTools.execute("import_notion_page", %{"url" => "https://example.com"}, [])
end
```

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir/assistant/notion_tools_test.exs
```

- [ ] **Step 3: Implement NotionTools + wire ToolExecutor**

`notion_tools.ex` pattern like `SettingsTools`:

```elixir
@tools ~w(import_notion_page)

def tool_specs do
  [
    %{
      "name" => "import_notion_page",
      "description" =>
        "Download a Notion page or database by URL into temporary Markdown + assets under /tmp/symphony-notion/. Returns paths for the agent to read; does not write to the KB or create issues.",
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["url"],
        "properties" => %{
          "url" => %{"type" => "string", "description" => "Full Notion page or database URL."}
        }
      }
    }
  ]
end

def execute("import_notion_page", %{"url" => url}, _opts) when is_binary(url) do
  case Importer.import_url(url) do
    {:ok, data} ->
      {:ok,
       %{
         tool: "import_notion_page",
         message: "Imported Notion #{data.kind}: #{data.title}",
         data: data
       }}

    {:error, reason} ->
      {:error, reason}
  end
end
```

In `tool_executor.ex`:

- `alias SymphonyElixir.Assistant.NotionTools`
- `@notion_tools NotionTools.tools()`
- Add `NotionTools.tool_specs()` to `build_tool_specs/0` and `freeform_tool_specs/0`
- In `freeform_codex_tool_executor`, branch `name in @notion_tools -> wrap_for_codex(NotionTools.execute(...))`
- In `do_execute`, add clause `when tool in @notion_tools` → `NotionTools.execute(tool, arguments, opts)` (project slug ignored; import is global)

Map errors to existing codex failure helpers (`:missing_api_key`, `:invalid_notion_url`, `:forbidden`, …) with clear messages.

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir/assistant/notion_tools_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/notion_tools.ex \
  elixir/test/symphony_elixir/assistant/notion_tools_test.exs \
  elixir/lib/symphony_elixir/assistant/tool_executor.ex
git commit -m "$(cat <<'EOF'
feat(notion): expose import_notion_page assistant tool

EOF
)"
```

---

### Task 7: Tracker HTTP controller + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/notion_controller.ex`
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/notion_controller_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`

- [ ] **Step 1: Write failing controller test**

Follow patterns in `credentials_controller_test.exs` (auth header / tracker token). Cases:

1. `POST /api/tracker/v1/notion/import` without key → 4xx with missing credential message  
2. Invalid URL → 400  
3. With stubbed importer (or Process dict) → 200 + `data.import_id`  
4. `GET /api/tracker/v1/notion/imports/:id` after a real tmp write → markdown body  

For (3)/(4), write a tiny temp tree in the test and have `show` read it — or call Importer with injectable http then GET.

- [ ] **Step 2: Run — expect FAIL**

```bash
mise exec -- mix test test/symphony_elixir_web/controllers/tracker/notion_controller_test.exs
```

- [ ] **Step 3: Implement controller + routes**

Router (inside `pipe_through(:tracker_api)` scope):

```elixir
post("/notion/import", NotionController, :import)
get("/notion/imports/:import_id", NotionController, :show)
```

Controller:

```elixir
def import(conn, %{"url" => url}) when is_binary(url) do
  case Importer.import_url(url) do
    {:ok, data} -> json(conn, %{data: data})
    {:error, :missing_api_key} -> TrackerErrors.validation_msg(conn, "Notion API key not configured. Set it in Settings → Providers or NOTION_API_KEY.")
    {:error, :invalid_notion_url} -> TrackerErrors.validation_msg(conn, "Invalid Notion URL.")
    {:error, :forbidden} -> TrackerErrors.validation_msg(conn, "Notion returned 403. Share the page/database with the Integration.")
    {:error, reason} -> TrackerErrors.validation_msg(conn, inspect(reason))
  end
end

def show(conn, %{"import_id" => import_id}) do
  # validate import_id is UUID-like; reject path traversal
  # read meta.json + page.md under tmp root
  # json %{data: %{meta: ..., markdown: ..., assets: [filenames]}}
end
```

Reject `import_id` containing `..`, `/`, or non-UUID.

- [ ] **Step 4: Run — expect PASS**

```bash
mise exec -- mix test test/symphony_elixir_web/controllers/tracker/notion_controller_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/notion_controller.ex \
  elixir/test/symphony_elixir_web/controllers/tracker/notion_controller_test.exs \
  elixir/lib/symphony_elixir_web/router.ex
git commit -m "$(cat <<'EOF'
feat(notion): add tracker HTTP import and preview endpoints

EOF
)"
```

---

### Task 8: Tracker client + URL detect + NotionImportCard + Sheet

**Files:**
- Create: `tracker/src/services/notion.ts`
- Create: `tracker/src/lib/notionUrl.ts`
- Create: `tracker/src/lib/__tests__/notionUrl.test.ts`
- Create: `tracker/src/components/assistant/NotionImportCard.tsx`
- Create: `tracker/src/components/assistant/NotionImportPreviewSheet.tsx`
- Create: `tracker/src/components/assistant/__tests__/NotionImportCard.test.tsx`
- Modify: locales `en` + `pt-BR`

- [ ] **Step 1: Write failing URL + card tests**

`notionUrl.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractNotionUrls } from "@/lib/notionUrl";

describe("extractNotionUrls", () => {
  it("finds notion.so URLs in text", () => {
    const text = "see https://www.notion.so/abc123def4567890abc123def4567890 please";
    expect(extractNotionUrls(text)[0]).toContain("notion.so");
  });

  it("returns empty for non-notion links", () => {
    expect(extractNotionUrls("https://example.com")).toEqual([]);
  });
});
```

Card test: render with fixture props; click Open preview calls `onOpenPreview`.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd tracker && npm test -- src/lib/__tests__/notionUrl.test.ts
```

(WSL: only this file.)

- [ ] **Step 3: Implement lib + services + UI**

`notionUrl.ts` — regex for `https://(?:www\.)?notion\.so/[^\s)]+`

`notion.ts`:

```typescript
export async function importNotionPage(url: string): Promise<NotionImportResult> { ... POST ... }
export async function fetchNotionImport(importId: string): Promise<NotionImportDetail> { ... GET ... }
```

`NotionImportCard` — title, kind badge, asset count, truncated `preview_markdown`, button Open preview.

`NotionImportPreviewSheet` — controlled `open`/`onOpenChange`; on open fetch detail; render `<Markdown>{markdown}</Markdown>`; list assets.

i18n keys under `assistant.notionImport.*`.

- [ ] **Step 4: Run tests**

```bash
cd tracker && npm test -- src/lib/__tests__/notionUrl.test.ts
```

Then:

```bash
cd tracker && npm test -- src/components/assistant/__tests__/NotionImportCard.test.tsx
```

Expected: PASS each.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/notion.ts tracker/src/lib/notionUrl.ts \
  tracker/src/lib/__tests__/notionUrl.test.ts \
  tracker/src/components/assistant/NotionImportCard.tsx \
  tracker/src/components/assistant/NotionImportPreviewSheet.tsx \
  tracker/src/components/assistant/__tests__/NotionImportCard.test.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(notion): add import card and markdown preview sheet

EOF
)"
```

---

### Task 9: Wire composer confirm chip + panel

**Files:**
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Create: `tracker/src/components/assistant/__tests__/notionImportComposer.test.tsx` (or extend an existing composer test file with a focused `-t` name)

- [ ] **Step 1: Write failing test**

Assert: when draft text contains a Notion URL, a button/chip with test id `notion-import-chip` is visible; clicking it calls `importNotionPage` (mock) and invokes `onNotionImported` callback.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd tracker && npm test -- src/components/assistant/__tests__/notionImportComposer.test.tsx
```

- [ ] **Step 3: Implement wiring**

Composer:

- `extractNotionUrls(draft)` → if non-empty, show **Import from Notion** chip (first URL).
- On click: call `importNotionPage(url)`; toast errors (`missing key` → Providers hint); on success call `onNotionImported?.(result)`.

Panel:

- State: `notionImport: NotionImportResult | null`, `notionPreviewOpen`
- Render `NotionImportCard` in the timeline/footer area when result present (and when tool results later include `import_notion_page` — parse tool output JSON for same shape if an existing tool-result renderer hook exists; minimum v1: composer path + if tool message data is already shown as JSON, also detect `tool === "import_notion_page"` in the assistant message stream where CreatePlanCard is mounted).

Find where `CreatePlanCard` is mounted in `ProjectAssistantPanel` and add a parallel branch for Notion import payloads from tool results when `data.import_id` + `data.markdown_path` exist.

Sheet: `NotionImportPreviewSheet` bound to selected `import_id`.

- [ ] **Step 4: Run — expect PASS**

```bash
cd tracker && npm test -- src/components/assistant/__tests__/notionImportComposer.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/AssistantComposer.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/__tests__/notionImportComposer.test.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(notion): composer import chip and assistant panel preview

EOF
)"
```

---

### Task 10: Skill + README

**Files:**
- Create: `skills/notion/SKILL.md`
- Modify: `skills/README.md`
- Modify: `elixir/README.md` (short subsection)

- [ ] **Step 1: Write SKILL.md**

```markdown
---
name: notion
description: >
  Import Notion pages or databases as temporary Markdown and assets via
  Symphony's import_notion_page tool. Use when the user pastes a Notion URL,
  asks to pull Notion content, or needs Markdown/images from Notion for issues
  or the KB.
---

# Notion import

## Setup

- Settings → Providers → Notion Integration token, or `NOTION_API_KEY`
- Share the page/database with the Integration in Notion

## Tool

Call `import_notion_page` with `{ "url": "<notion url>" }`.

Returns `markdown_path`, `assets_dir`, `meta_path` under `/tmp/symphony-notion/`.

If the tool is missing from the session: `mix symphony.tool call import_notion_page --url '...' --json`

## Rules

- Treat `/tmp` as temporary; do not assume it survives restarts
- Do not invent page content if import fails
- Only create issues or write KB pages when the user asks
- Prefer reading `markdown_path` with existing read tools after import
```

Update `skills/README.md` list to include `notion/`.

Add a short “Notion import” blurb to `elixir/README.md` near other integrations.

- [ ] **Step 2: No automated test** — manually confirm skill path resolves via symlink `.claude/skills` → `../skills`.

- [ ] **Step 3: Commit**

```bash
git add skills/notion/SKILL.md skills/README.md elixir/README.md
git commit -m "$(cat <<'EOF'
docs(notion): add import skill and README note

EOF
)"
```

- [ ] **Step 4: Update plan checkboxes** as tasks complete; mark spec/plan done in the PR body when opening a PR.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Global credential + env fallback | 1 |
| URL parse incl. `p=` | 2 |
| Page blocks → MD + assets | 3, 4, 5 |
| Database → table, 100-row cap, warnings | 3, 5 |
| `/tmp/symphony-notion/<id>/` layout | 5 |
| Tool `import_notion_page` | 6 |
| HTTP POST/GET | 7 |
| Composer confirm chip (not auto) | 9 |
| Import card + Sheet preview | 8, 9 |
| Skill + env example + README | 1, 10 |
| Error messages (key, 403, bad URL) | 5, 6, 7 |
| No auto KB/issue | 5, 6, 10 (by design) |

## Out of plan (explicit)

- Per-project tokens, TTL sweeper, Save-to-KB button, Magic palette, recursive DB page bodies, rich toggles/synced blocks.
