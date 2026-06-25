# Knowledge Base - Milestone 3: Full-text Search (SQLite FTS5) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task with review between tasks, or **(B)** inline execution with checkpoints. All Elixir commands run from `elixir/`. Depends on M1 (read) and M2 (write events) being merged.

**Goal:** Provide full-text search over KB page **title + body** (not title-only as in the reference clone), scoped per project (with optional repository filter) and globally for the user KB, backed by a derived SQLite FTS5 index that is rebuildable from Git at any time and updated incrementally on save/sync.

**Architecture:** A standard Ecto table `kb_pages` stores per-page metadata + body (project_slug, repo_slug, path, title, body, archived). A companion external-content FTS5 virtual table `kb_pages_fts` indexes `title`/`body`, kept in sync by SQL triggers. `KnowledgeBase.Indexer` reindexes a repository (or single page) by reading Markdown files through `Workspace.ensure/2` + `Tree`/`MarkdownPage`. `KnowledgeBase.Search` runs `MATCH` queries with `bm25()` ranking + `snippet()` excerpts via `Repo.query/3`. The KB write functions (M2) call `Indexer` after each commit; a new `GET /kb/search` and `GET /projects/:slug/kb/search` expose results.

**Tech Stack:** Elixir/Phoenix, Ecto + `ecto_sqlite3`/`exqlite` 0.36 (FTS5 enabled by default), raw SQL via `SymphonyElixir.Repo.query/3`.

---

## Plan sequence

M1 read -> M2 editing/auto-commit -> **M3 full-text search (this plan)** -> M4 git background flows -> M5 general KB -> M6 frontend -> M7 assistant tools. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md` (D9 + Section 6/8).

---

## File structure (M3)

Create:
- `elixir/priv/repo/migrations/20260626000100_create_kb_pages.exs` - metadata table.
- `elixir/priv/repo/migrations/20260626000200_create_kb_pages_fts.exs` - FTS5 virtual table + sync triggers.
- `elixir/lib/symphony_elixir/knowledge_base/page_record.ex` - Ecto schema for `kb_pages`.
- `elixir/lib/symphony_elixir/knowledge_base/indexer.ex` - (re)index a repo / single page / remove a page.
- `elixir/lib/symphony_elixir/knowledge_base/search.ex` - FTS query + ranking + snippet.
- `elixir/test/symphony_elixir/knowledge_base/fts_availability_test.exs` - runtime FTS5 probe.
- `elixir/test/symphony_elixir/knowledge_base/indexer_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/search_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs`

Modify:
- `elixir/lib/symphony_elixir/knowledge_base.ex` - call `Indexer` after write/move/delete; add `search/2`, `search_project/3`, `reindex_repo/2`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex` - add `search` (project) and a new general `search` action.
- `elixir/lib/symphony_elixir_web/router.ex` - add search routes.

Locked decisions:
- Tokenizer: `unicode61 remove_diacritics 2` (accent-insensitive; good for PT/EN). Configured in the FTS5 `CREATE VIRTUAL TABLE`.
- Index lives in the main tracker SQLite DB (single file, simplest; WAL already enabled). Rebuildable, so no migration data risk.
- `kb_pages` is keyed by `(project_slug, repo_slug, path)` unique; `project_slug = "@user"` reserved sentinel for the general KB (populated in M5; harmless empty here).
- Ranking uses `bm25(kb_pages_fts)` ascending (lower = more relevant); excerpt via `snippet(kb_pages_fts, 1, '[', ']', ' ... ', 12)` on the body column (column index 1).

---

## Task 1: FTS5 availability probe (guard test)

**Files:**
- Test: `elixir/test/symphony_elixir/knowledge_base/fts_availability_test.exs`

This is a guard so a build without FTS5 fails loudly and early.

- [ ] **Step 1: Write the test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.FtsAvailabilityTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    :ok
  end

  test "SQLite build has FTS5 enabled" do
    assert {:ok, _} = Repo.query("CREATE VIRTUAL TABLE temp.kb_fts_probe USING fts5(x)")
    assert {:ok, _} = Repo.query("DROP TABLE temp.kb_fts_probe")
  end
end
```

- [ ] **Step 2: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/fts_availability_test.exs`
Expected: PASS. If it FAILS with `no such module: fts5`, stop: the exqlite build lacks FTS5 and the rest of M3 cannot proceed (escalate; do not work around).

- [ ] **Step 3: Commit**

```bash
git add elixir/test/symphony_elixir/knowledge_base/fts_availability_test.exs
git commit -m "test(kb): assert SQLite FTS5 availability"
```

---

## Task 2: `kb_pages` metadata table + schema

**Files:**
- Create: `elixir/priv/repo/migrations/20260626000100_create_kb_pages.exs`
- Create: `elixir/lib/symphony_elixir/knowledge_base/page_record.ex`
- Test: extend `elixir/test/symphony_elixir/local_tracker/migrations_test.exs` (or new `kb_pages_migration_test.exs`)

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateKbPages do
  use Ecto.Migration

  def change do
    create table(:kb_pages) do
      add(:project_slug, :string, null: false)
      add(:repo_slug, :string, null: false)
      add(:path, :string, null: false)
      add(:title, :string, null: false, default: "")
      add(:body, :text, null: false, default: "")
      add(:archived, :boolean, null: false, default: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:kb_pages, [:project_slug, :repo_slug, :path]))
    create(index(:kb_pages, [:project_slug]))
  end
end
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.PageRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.PageRecord
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0, truncate_tracker!: 1]

  setup do
    migrate_repo()
    on_exit(fn -> truncate_tracker!([:kb_pages]) end)
    :ok
  end

  test "inserts and enforces uniqueness on project/repo/path" do
    attrs = %{project_slug: "p", repo_slug: "acme~web", path: "index.md", title: "Home", body: "hello"}
    assert {:ok, _} = %PageRecord{} |> PageRecord.changeset(attrs) |> Repo.insert()
    assert {:error, cs} = %PageRecord{} |> PageRecord.changeset(attrs) |> Repo.insert()
    refute cs.valid?
  end
end
```

(If `truncate_tracker!/1` requires the table to be in its known set, add `kb_pages` to that helper's list or call `Repo.delete_all(PageRecord)` in `on_exit` instead.)

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/page_record_test.exs`
Expected: FAIL (schema undefined).

- [ ] **Step 4: Write the schema**

```elixir
defmodule SymphonyElixir.KnowledgeBase.PageRecord do
  @moduledoc "Ecto schema for derived KB page metadata (search index source)."

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  schema "kb_pages" do
    field(:project_slug, :string)
    field(:repo_slug, :string)
    field(:path, :string)
    field(:title, :string, default: "")
    field(:body, :string, default: "")
    field(:archived, :boolean, default: false)

    timestamps(type: :utc_datetime_usec)
  end

  @required ~w(project_slug repo_slug path)a
  @optional ~w(title body archived)a

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
    |> unique_constraint(:path, name: :kb_pages_project_slug_repo_slug_path_index)
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/page_record_test.exs`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260626000100_create_kb_pages.exs elixir/lib/symphony_elixir/knowledge_base/page_record.ex elixir/test/symphony_elixir/knowledge_base/page_record_test.exs
git commit -m "feat(kb): add kb_pages metadata table and schema"
```

---

## Task 3: FTS5 virtual table + triggers migration

**Files:**
- Create: `elixir/priv/repo/migrations/20260626000200_create_kb_pages_fts.exs`
- Test: `elixir/test/symphony_elixir/knowledge_base/fts_sync_test.exs`

External-content FTS5 keeps the index synchronized with `kb_pages` via triggers, so search reflects every insert/update/delete automatically.

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.CreateKbPagesFts do
  use Ecto.Migration

  def up do
    execute("""
    CREATE VIRTUAL TABLE kb_pages_fts USING fts5(
      title,
      body,
      content='kb_pages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    )
    """)

    execute("""
    CREATE TRIGGER kb_pages_ai AFTER INSERT ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END
    """)

    execute("""
    CREATE TRIGGER kb_pages_ad AFTER DELETE ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(kb_pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END
    """)

    execute("""
    CREATE TRIGGER kb_pages_au AFTER UPDATE ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(kb_pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO kb_pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END
    """)
  end

  def down do
    execute("DROP TRIGGER IF EXISTS kb_pages_au")
    execute("DROP TRIGGER IF EXISTS kb_pages_ad")
    execute("DROP TRIGGER IF EXISTS kb_pages_ai")
    execute("DROP TABLE IF EXISTS kb_pages_fts")
  end
end
```

- [ ] **Step 2: Write the failing test** (inserts via the schema, queries FTS via MATCH)

```elixir
defmodule SymphonyElixir.KnowledgeBase.FtsSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.PageRecord
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)
    :ok
  end

  test "inserting a page makes it discoverable by body text via MATCH" do
    {:ok, _} =
      %PageRecord{}
      |> PageRecord.changeset(%{project_slug: "p", repo_slug: "acme~web", path: "a.md", title: "Auth", body: "rotate the refresh token nightly"})
      |> Repo.insert()

    assert {:ok, %{rows: [[count]]}} =
             Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["refresh"])

    assert count == 1
  end

  test "updating body re-syncs the index (old terms gone, new terms present)" do
    {:ok, record} =
      %PageRecord{}
      |> PageRecord.changeset(%{project_slug: "p", repo_slug: "acme~web", path: "a.md", title: "T", body: "alpha"})
      |> Repo.insert()

    {:ok, _} = record |> PageRecord.changeset(%{body: "bravo"}) |> Repo.update()

    assert {:ok, %{rows: [[0]]}} = Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["alpha"])
    assert {:ok, %{rows: [[1]]}} = Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["bravo"])
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/fts_sync_test.exs`
Expected: FAIL (no `kb_pages_fts` table) before migration is picked up; after adding the migration it should pass. `migrate_repo/0` runs migrations against the test DB.

- [ ] **Step 4: Confirm migration is applied**

The migration file added in Step 1 is applied by `migrate_repo/0`. Re-run Step 3.

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/fts_sync_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260626000200_create_kb_pages_fts.exs elixir/test/symphony_elixir/knowledge_base/fts_sync_test.exs
git commit -m "feat(kb): add FTS5 index and sync triggers for kb_pages"
```

---

## Task 4: `KnowledgeBase.Indexer`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/indexer.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/indexer_test.exs`

The indexer is the only writer of `kb_pages` rows. It can (a) upsert a single page, (b) remove a page, and (c) reindex a whole repo (read every Markdown file via M1 helpers, upsert each, delete rows whose files vanished).

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.IndexerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{Indexer, PageRecord}
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    docs = Path.join(System.tmp_dir!(), "kb-idx-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(docs, "sub"))
    File.write!(Path.join(docs, "index.md"), "---\ntitle: Home\n---\n# Home\n\nwelcome aboard\n")
    File.write!(Path.join(docs, "sub/a.md"), "---\ntitle: Alpha\n---\n# Alpha\n\nsecret payload\n")
    on_exit(fn -> File.rm_rf(docs) end)
    {:ok, docs: docs}
  end

  test "reindex_dir inserts a row per page with title and body", %{docs: docs} do
    assert {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)

    rows = Repo.all(PageRecord) |> Enum.sort_by(& &1.path)
    assert Enum.map(rows, & &1.path) == ["index.md", "sub/a.md"]
    assert Enum.find(rows, &(&1.path == "sub/a.md")).title == "Alpha"
    assert Enum.find(rows, &(&1.path == "sub/a.md")).body =~ "secret payload"
  end

  test "reindex_dir prunes rows whose files were removed", %{docs: docs} do
    {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)
    File.rm!(Path.join(docs, "sub/a.md"))
    assert {:ok, 1} = Indexer.reindex_dir("acme", "acme~web", docs)
    assert Repo.aggregate(PageRecord, :count) == 1
  end

  test "remove_page deletes a single row", %{docs: docs} do
    {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)
    assert {:ok, _} = Indexer.remove_page("acme", "acme~web", "index.md")
    refute Enum.any?(Repo.all(PageRecord), &(&1.path == "index.md"))
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/indexer_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Indexer do
  @moduledoc """
  Maintains the derived `kb_pages` rows that feed the FTS5 search index.
  Git remains the source of truth; this index is rebuildable at any time.
  """

  import Ecto.Query

  alias SymphonyElixir.KnowledgeBase.{MarkdownPage, PageRecord, Tree}
  alias SymphonyElixir.Repo

  @spec reindex_dir(String.t(), String.t(), Path.t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def reindex_dir(project_slug, repo_slug, docs_root) when is_binary(docs_root) do
    paths = if File.dir?(docs_root), do: Tree.page_paths(docs_root), else: []

    Repo.transaction(fn ->
      Enum.each(paths, fn rel -> upsert_from_file(project_slug, repo_slug, docs_root, rel) end)
      prune(project_slug, repo_slug, paths)
      length(paths)
    end)
  end

  @spec index_page(String.t(), String.t(), String.t(), String.t()) :: {:ok, PageRecord.t()} | {:error, term()}
  def index_page(project_slug, repo_slug, rel, content) do
    {title, body} = title_and_body(content, rel)
    upsert(project_slug, repo_slug, rel, title, body)
  end

  @spec remove_page(String.t(), String.t(), String.t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def remove_page(project_slug, repo_slug, rel) do
    {count, _} =
      PageRecord
      |> where([p], p.project_slug == ^project_slug and p.repo_slug == ^repo_slug and p.path == ^rel)
      |> Repo.delete_all()

    {:ok, count}
  end

  defp upsert_from_file(project_slug, repo_slug, docs_root, rel) do
    case File.read(Path.join(docs_root, rel)) do
      {:ok, content} ->
        {title, body} = title_and_body(content, rel)
        upsert(project_slug, repo_slug, rel, title, body)

      _ ->
        :skip
    end
  end

  defp title_and_body(content, rel) do
    case MarkdownPage.parse(content, default_title: Path.basename(rel, ".md")) do
      {:ok, page} -> {page.title, page.body}
      _ -> {Path.basename(rel, ".md"), content}
    end
  end

  defp upsert(project_slug, repo_slug, rel, title, body) do
    %PageRecord{}
    |> PageRecord.changeset(%{project_slug: project_slug, repo_slug: repo_slug, path: rel, title: title, body: body, archived: false})
    |> Repo.insert(
      on_conflict: {:replace, [:title, :body, :archived, :updated_at]},
      conflict_target: [:project_slug, :repo_slug, :path]
    )
  end

  defp prune(project_slug, repo_slug, keep_paths) do
    PageRecord
    |> where([p], p.project_slug == ^project_slug and p.repo_slug == ^repo_slug and p.path not in ^keep_paths)
    |> Repo.delete_all()
  end
end
```

Requires `Tree.page_paths/1` (a flat list of relative `.md` paths). If M1's `Tree` only exposes `build/1`, add `page_paths/1`:

```elixir
  @spec page_paths(Path.t()) :: [String.t()]
  def page_paths(docs_root) do
    docs_root
    |> walk("")
    |> Enum.sort()
  end
```

where `walk/2` recurses excluding the ignored dirs (`assets`, dotfiles) and returns relative `.md` paths. Reuse M1's traversal; add a small test in `tree_test.exs` for `page_paths/1` if it didn't exist.

Note on `on_conflict: {:replace, ...}` updating `:updated_at`: include `:updated_at` explicitly in the replace list (Ecto won't autogenerate it on conflict-replace). The `kb_pages_au` trigger then re-syncs the FTS row.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/indexer_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/indexer.ex elixir/lib/symphony_elixir/knowledge_base/tree.ex elixir/test/symphony_elixir/knowledge_base/indexer_test.exs
git commit -m "feat(kb): index pages into kb_pages for search"
```

---

## Task 5: `KnowledgeBase.Search`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/search.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/search_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.SearchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{Indexer, PageRecord, Search}
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    insert("acme", "acme~web", "auth.md", "Authentication", "rotate the refresh token nightly")
    insert("acme", "acme~api", "tokens.md", "Tokens", "the refresh flow lives here")
    insert("acme", "acme~web", "ui.md", "Buttons", "unrelated content about colors")
    :ok
  end

  test "query returns ranked results across repos with a snippet" do
    assert {:ok, results} = Search.search_project("acme", "refresh", [])
    paths = Enum.map(results, & &1.path)
    assert "auth.md" in paths and "tokens.md" in paths
    refute "ui.md" in paths
    assert Enum.all?(results, &is_binary(&1.snippet))
    assert Enum.all?(results, &(&1.repo_slug in ["acme~web", "acme~api"]))
  end

  test "repo filter narrows results to one repository" do
    assert {:ok, results} = Search.search_project("acme", "refresh", repo_slug: "acme~web")
    assert Enum.map(results, & &1.repo_slug) |> Enum.uniq() == ["acme~web"]
  end

  test "blank or too-short queries return an empty list without error" do
    assert {:ok, []} = Search.search_project("acme", "  ", [])
    assert {:ok, []} = Search.search_project("acme", "a", [])
  end

  test "special FTS characters are treated as literal terms" do
    insert("acme", "acme~web", "weird.md", "C++ guide", "pointers and refs")
    assert {:ok, results} = Search.search_project("acme", "C++", [])
    assert Enum.any?(results, &(&1.path == "weird.md"))
  end

  defp insert(p, r, path, title, body) do
    {:ok, _} = Indexer.index_page(p, r, path, "---\ntitle: #{title}\n---\n#{body}\n")
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/search_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Search do
  @moduledoc """
  Full-text search over the derived `kb_pages` FTS5 index.

  Searches title + body, ranks by `bm25`, and returns a snippet excerpt.
  User input is converted into a safe FTS5 MATCH expression so reserved
  characters cannot break the query or inject operators.
  """

  alias SymphonyElixir.Repo

  @min_query_length 2
  @default_limit 25
  @max_limit 50

  @type result :: %{
          project_slug: String.t(),
          repo_slug: String.t(),
          path: String.t(),
          title: String.t(),
          snippet: String.t(),
          rank: float()
        }

  @spec search_project(String.t(), String.t(), keyword()) :: {:ok, [result()]} | {:error, term()}
  def search_project(project_slug, query, opts \\ []) do
    run(["p.project_slug = ?"], [project_slug], query, opts)
  end

  @spec search_global(String.t(), String.t(), keyword()) :: {:ok, [result()]} | {:error, term()}
  def search_global(user_scope, query, opts \\ []) do
    run(["p.project_slug = ?"], [user_scope], query, opts)
  end

  defp run(base_clauses, base_params, query, opts) do
    case build_match(query) do
      :too_short ->
        {:ok, []}

      {:ok, match} ->
        {clauses, params} = apply_repo_filter(base_clauses, base_params, opts)
        limit = opts |> Keyword.get(:limit, @default_limit) |> min(@max_limit) |> max(1)
        where_sql = Enum.join(["p.archived = 0", "kb_pages_fts MATCH ?" | clauses], " AND ")

        sql = """
        SELECT p.project_slug, p.repo_slug, p.path, p.title,
               snippet(kb_pages_fts, 1, '[', ']', ' ... ', 12) AS snippet,
               bm25(kb_pages_fts) AS rank
        FROM kb_pages_fts
        JOIN kb_pages p ON p.id = kb_pages_fts.rowid
        WHERE #{where_sql}
        ORDER BY rank ASC
        LIMIT ?
        """

        case Repo.query(sql, [match | params] ++ [limit]) do
          {:ok, %{rows: rows, columns: cols}} -> {:ok, Enum.map(rows, &row_to_result(cols, &1))}
          {:error, reason} -> {:error, {:kb_search_failed, reason}}
        end
    end
  end

  defp apply_repo_filter(clauses, params, opts) do
    case Keyword.get(opts, :repo_slug) do
      slug when is_binary(slug) and slug != "" -> {["p.repo_slug = ?" | clauses], params ++ [slug]}
      _ -> {clauses, params}
    end
  end

  # Turn arbitrary user text into a safe FTS5 MATCH: split on whitespace,
  # double-quote each token (escaping embedded quotes), prefix-match the last
  # token for incremental search.
  defp build_match(query) do
    trimmed = query |> to_string() |> String.trim()

    if String.length(trimmed) < @min_query_length do
      :too_short
    else
      tokens = trimmed |> String.split(~r/\s+/, trim: true) |> Enum.map(&quote_token/1)

      case tokens do
        [] -> :too_short
        _ -> {:ok, prefixize_last(tokens)}
      end
    end
  end

  defp quote_token(token), do: "\"" <> String.replace(token, "\"", "\"\"") <> "\""

  defp prefixize_last(tokens) do
    {init, [last]} = Enum.split(tokens, length(tokens) - 1)
    Enum.join(init ++ [last <> " *"], " ")
  end

  defp row_to_result(cols, row) do
    map = cols |> Enum.zip(row) |> Map.new()

    %{
      project_slug: map["project_slug"],
      repo_slug: map["repo_slug"],
      path: map["path"],
      title: map["title"],
      snippet: map["snippet"] || "",
      rank: map["rank"] * 1.0
    }
  end
end
```

Note: `prefixize_last` appends ` *` after the quoted last token to enable FTS5 prefix matching (`"refre" *`-style). Verify the exact prefix syntax against the test "ranked results" - FTS5 prefix is `token*` outside quotes; with quoted tokens use the form `"refresh" *`. The "C++" test confirms reserved chars are safe because the whole token is quoted. If the prefix form misbehaves, drop `prefixize_last` and just `Enum.join(tokens, " ")`; the tests other than incremental prefix will still pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/search_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/search.ex elixir/test/symphony_elixir/knowledge_base/search_test.exs
git commit -m "feat(kb): full-text search with bm25 ranking and snippets"
```

---

## Task 6: Wire indexing into KB write/move/delete + reindex API

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base_test.exs` (add a search-after-save case)

- [ ] **Step 1: Update context write functions to index after commit**

After a successful `Writer.write_page`, also index the page; after delete, remove it; after move, remove old + index new. Add public `search/3` and `reindex_repo/2`:

```elixir
  alias SymphonyElixir.KnowledgeBase.{Indexer, Search}

  # inside write_page/4, after Writer.write_page returns {:ok, result}:
  #   _ = Indexer.index_page(project_slug, repo_slug, result.path, page_content_for_index(page))
  # where page_content_for_index serializes via Frontmatter for index parity.

  @spec search_project(String.t(), String.t(), keyword()) :: {:ok, [map()]} | {:error, error()}
  def search_project(project_slug, query, opts \\ []) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      Search.search_project(project_slug, query, opts)
    end
  end

  @spec reindex_repo(String.t(), String.t()) :: {:ok, non_neg_integer()} | {:error, error()}
  def reindex_repo(project_slug, repo_slug) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      Indexer.reindex_dir(project_slug, repo_slug, ws.docs_root)
    end
  end
```

For `write_page`, index using the serialized content so the index matches the file exactly:

```elixir
  defp index_after_save(project_slug, repo_slug, %{path: path}, page) do
    content = SymphonyElixir.KnowledgeBase.Frontmatter.serialize(page.frontmatter, page.body)
    _ = Indexer.index_page(project_slug, repo_slug, path, content)
    :ok
  end
```

call `index_after_save/4` inside the `{:ok, result}` branch of `write_page`; `Indexer.remove_page/3` in `delete_page`; and in `move_page` call `remove_page` for `result.from` and `reindex` the new path by reading the moved file.

- [ ] **Step 2: Write the failing test (append to context test)**

```elixir
  test "a saved page is immediately findable via project search", %{} do
    {:ok, _} = KnowledgeBase.write_page("acme", "web", "search-me.md", %{frontmatter: %{"title" => "Find Me"}, body: "a unique zebra phrase"})
    assert {:ok, results} = KnowledgeBase.search_project("acme", "zebra", [])
    assert Enum.any?(results, &(&1.path == "search-me.md"))
  end
```

- [ ] **Step 3: Run test to verify it fails, then passes after wiring**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs`
Expected: PASS after Step 1 wiring.

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base.ex elixir/test/symphony_elixir/knowledge_base_test.exs
git commit -m "feat(kb): index pages on save and expose project search"
```

---

## Task 7: Search endpoints + routes

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs`

- [ ] **Step 1: Add routes**

```elixir
    get("/projects/:project_slug/kb/search", KnowledgeBaseController, :search_project)
    get("/kb/search", KnowledgeBaseController, :search_general)
```

(`/kb/search` general endpoint returns `[]` until M5 populates the `@user` scope; the route exists now so the frontend can build against it.)

- [ ] **Step 2: Write the failing test**

```elixir
  test "GET project search returns ranked matches" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/note.md", %{"frontmatter" => %{"title" => "Note"}, "body" => "a unique giraffe term"})
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/search?q=giraffe")
    results = json_response(conn, 200)["data"]
    assert Enum.any?(results, &(&1["path"] == "note.md"))
    assert Enum.all?(results, &Map.has_key?(&1, "snippet"))
  end

  test "GET project search with repo filter" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/x.md", %{"frontmatter" => %{}, "body" => "filtered llama"})
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/search?q=llama&repo=web")
    assert json_response(conn, 200)["data"] |> Enum.all?(&(&1["repo_slug"] == "acme~web"))
  end

  test "GET general search returns an empty list (no user KB yet)" do
    conn = get(authorized_conn(), "/api/tracker/v1/kb/search?q=anything")
    assert json_response(conn, 200)["data"] == []
  end
```

(Use the same real-git-checkout setup as the M2 write controller test.)

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs`
Expected: FAIL (actions missing).

- [ ] **Step 4: Write minimal implementation**

```elixir
  @spec search_project(Conn.t(), map()) :: Conn.t()
  def search_project(conn, %{"project_slug" => slug} = params) do
    opts = search_opts(params)

    case KnowledgeBase.search_project(slug, Map.get(params, "q", ""), opts) do
      {:ok, results} -> json(conn, %{data: Enum.map(results, &search_payload/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec search_general(Conn.t(), map()) :: Conn.t()
  def search_general(conn, params) do
    case KnowledgeBase.search_general(Map.get(params, "q", ""), search_opts(params)) do
      {:ok, results} -> json(conn, %{data: Enum.map(results, &search_payload/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp search_opts(params) do
    repo = params["repo"]

    []
    |> maybe_put(:repo_slug, normalize_repo_filter(repo, params["project_slug"]))
    |> maybe_put(:limit, parse_limit(params["limit"]))
  end

  # `repo` in the URL is the per-project repo slug (e.g. "web"); the index stores
  # the global repo_slug ("acme~web"). Compose it from project + repo.
  defp normalize_repo_filter(nil, _project), do: nil
  defp normalize_repo_filter("", _project), do: nil
  defp normalize_repo_filter(repo, project) when is_binary(repo), do: "#{project}~#{repo}"

  defp parse_limit(nil), do: nil
  defp parse_limit(v) do
    case Integer.parse(to_string(v)) do
      {n, _} when n > 0 -> n
      _ -> nil
    end
  end

  defp maybe_put(opts, _k, nil), do: opts
  defp maybe_put(opts, k, v), do: Keyword.put(opts, k, v)

  defp search_payload(r) do
    %{project_slug: r.project_slug, repo_slug: r.repo_slug, path: r.path, title: r.title, snippet: r.snippet, rank: r.rank}
  end
```

Add `KnowledgeBase.search_general/2` delegating to `Search.search_global("@user", query, opts)` in the context.

Important: the index stores `repo_slug` in the **global** form (e.g. `acme~web`), so confirm `Indexer`/context store `RepoDocs.repo_slug(repo)` (global) rather than the per-project short slug. Align the M2 write path to pass the global repo slug into `index_page` so the `repo=web` filter composes correctly. Add a test asserting the stored `repo_slug` value if ambiguous.

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir/knowledge_base.ex elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs
git commit -m "feat(kb): expose project and general full-text search endpoints"
```

---

## Task 8: Milestone verification

- [ ] **Step 1:** `mix format --check-formatted`
- [ ] **Step 2:** `mix compile --warnings-as-errors`
- [ ] **Step 3:** `mix test test/symphony_elixir/knowledge_base test/symphony_elixir_web/controllers/tracker/knowledge_base_search_controller_test.exs` -> all pass
- [ ] **Step 4:** run the migrations against a fresh DB to confirm both up and down work:
  `MIX_ENV=test mix ecto.rollback -n 2 && MIX_ENV=test mix ecto.migrate` (or the project's migration helper). Confirm no errors.
- [ ] **Step 5:** commit any fixes (`chore(kb): format milestone 3`).

---

## Self-Review

**Spec coverage (M3):**

| Spec requirement | Task |
|---|---|
| D9 full-text over title+body via derived FTS5 index | Tasks 2-5 |
| D9 rebuildable, incremental on commit/sync | Task 4 (`reindex_dir`) + Task 6 (index on save) |
| D9 every row carries project/repository/path; scope/filter per repo | Tasks 2, 5, 7 |
| Section 6 search results with snippet + repo label | Task 5 (`snippet`, `repo_slug`) |
| Section 8 `GET /projects/:slug/kb/search?q=&repo=` + `GET /kb/search?q=` | Task 7 |

**Risks/decisions:**
- FTS5 availability is asserted by Task 1; if absent, M3 stops (no silent fallback).
- User input is sanitized into a quoted MATCH expression (Task 5) - prevents FTS syntax errors/injection. The `C++` test guards this.
- `repo_slug` is stored in the global form so the `repo` URL filter composes deterministically (Task 7 note + alignment with M2).
- External-content FTS + triggers means the schema's insert/update/delete keep the index correct automatically; `reindex_dir` is for full rebuilds and pruning vanished files.

**Placeholder scan:** No TBD/TODO. Two explicit verification notes (FTS prefix syntax in Task 5; `on_conflict` updated_at in Task 4) include concrete fallbacks.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-03-fulltext-search.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.
