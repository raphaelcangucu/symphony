# Knowledge Base - Milestone 1: Backend Read Foundation Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. All Elixir commands run from the `elixir/` directory. Test runner is `mix test`; formatter is `mix format`.

**Goal:** Expose a read-only, repository-scoped Knowledge Base API that lists a project's repositories, renders each repository's `docs/` tree, and reads individual Markdown pages (frontmatter + body + derived title), with strict path validation.

**Architecture:** A new `SymphonyElixir.KnowledgeBase` domain under `elixir/lib/symphony_elixir/knowledge_base/`. Pure modules (`Paths`, `MarkdownPage`, `Tree`) are unit-tested without I/O dependencies; integration modules (`RepoDocs`, the `KnowledgeBase` context) read files from each repository checkout resolved as `Config.workspace_root()/<project_slug>/<repo.workspace_path>/docs`. A thin Phoenix controller (`SymphonyElixirWeb.Tracker.KnowledgeBaseController`) renders `json(conn, %{data: ...})` and maps errors through `SymphonyElixirWeb.TrackerErrors`, matching existing tracker conventions (no FallbackController, no JSON view modules).

**Tech Stack:** Elixir/Phoenix, Ecto + SQLite (`ecto_sqlite3`), `yaml_elixir` (frontmatter), `jason`. React/Vite frontend is NOT part of this milestone.

---

## Plan sequence (whole feature)

This feature is split into independently shippable milestones. This file is **M1**. Later milestones get their own plan files:

- **M1 - Backend read foundation** (this plan): repositories list, repo docs tree, read page, path validation.
- M2 - Editing + auto-commit: write/move/delete page, frontmatter serialize, asset upload, commit/push to `symphony-docs`.
- M3 - Full-text search: `kb_pages` metadata table + SQLite FTS5 index + search endpoint.
- M4 - Git background flows: sync `symphony-docs` with default branch, PR creation + auto-merge, status states.
- M5 - General/personal KB: ensure/connect `symphony-kb` repo + home generator.
- M6 - Frontend KB UI: routes, service, hooks, repository-grouped sidebar tree, project home, editor, search UI, sync status.
- M7 - KB assistant tools: repository-aware read/maintain/task/sync tools.

Spec reference: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`.

---

## File structure (M1)

Create:
- `elixir/lib/symphony_elixir/knowledge_base/paths.ex` - path encoding/resolution/validation (pure).
- `elixir/lib/symphony_elixir/knowledge_base/markdown_page.ex` - frontmatter + body + title parsing (pure).
- `elixir/lib/symphony_elixir/knowledge_base/tree.ex` - walk a `docs/` directory into a page tree.
- `elixir/lib/symphony_elixir/knowledge_base/repo_docs.ex` - list/find repositories + docs detection.
- `elixir/lib/symphony_elixir/knowledge_base.ex` - public context (`project_overview/1`, `repo_tree/2`, `read_page/3`).
- `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex` - JSON endpoints.

Modify:
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` - add `:kb_invalid_path`, `:kb_page_not_found`, `:kb_frontmatter_invalid` clauses (reuse existing `:project_not_found`, `:repo_not_found`).
- `elixir/lib/symphony_elixir_web/router.ex` - add three GET routes under the `:tracker_api` scope.

Test:
- `elixir/test/symphony_elixir/knowledge_base/paths_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/markdown_page_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/tree_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/repo_docs_test.exs`
- `elixir/test/symphony_elixir/knowledge_base_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs`

Conventions locked here:
- Repository URL identifier (`repo_slug`) = `workspace_path` with `/` replaced by `~`. The `Repository` changeset forbids `~` in `workspace_path` (charset `[a-zA-Z0-9._-]` plus `/`), so the mapping is lossless and collision-free.
- A KB page is always `.md` under a repository's `docs/`. Paths with `..`, empty segments, absolute paths, or non-`.md` leaves are rejected.
- Generated/derived data only; Git remains the source of truth (no DB tables in M1).

---

## Task 1: `KnowledgeBase.Paths`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/paths.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/paths_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.PathsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Paths

  describe "repo_slug/1 and workspace_path_from_slug/1" do
    test "round-trips nested workspace paths" do
      assert Paths.repo_slug("acme/web") == "acme~web"
      assert Paths.workspace_path_from_slug("acme~web") == "acme/web"
    end

    test "leaves single-segment paths unchanged" do
      assert Paths.repo_slug("backend") == "backend"
      assert Paths.workspace_path_from_slug("backend") == "backend"
    end
  end

  describe "safe_relative_path/1" do
    test "accepts a nested markdown path from segments" do
      assert Paths.safe_relative_path(["architecture", "backend.md"]) ==
               {:ok, "architecture/backend.md"}
    end

    test "accepts a markdown path from a string" do
      assert Paths.safe_relative_path("index.md") == {:ok, "index.md"}
    end

    test "rejects parent traversal, empty segments, and non-markdown leaves" do
      assert Paths.safe_relative_path(["..", "secrets.md"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path(["a", "", "b.md"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path(["notes.txt"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path([]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path("/etc/passwd.md") == {:error, :kb_invalid_path}
    end
  end

  describe "resolve_page/3" do
    test "resolves a page inside the repo docs root" do
      {:ok, full} = Paths.resolve_page("proj", "web", ["guide.md"])
      assert String.ends_with?(full, "/proj/web/docs/guide.md")
    end

    test "rejects traversal even if it would escape docs root" do
      assert Paths.resolve_page("proj", "web", ["..", "..", "x.md"]) ==
               {:error, :kb_invalid_path}
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/paths_test.exs`
Expected: FAIL with `module SymphonyElixir.KnowledgeBase.Paths is not available` (or `function ... is undefined`).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Paths do
  @moduledoc """
  Path resolution and validation for the Git-backed knowledge base.

  Knowledge base files live under a repository checkout's `docs/` directory:

      <workspace_root>/<project_slug>/<repo.workspace_path>/docs/<relative_path>

  Repositories are addressed in URLs by a reversible `repo_slug`. A workspace
  path may contain `/`, which a single route segment cannot hold, so `/` is
  encoded as `~` - a character the repository changeset forbids in
  `workspace_path` - keeping the mapping lossless and collision-free.
  """

  alias SymphonyElixir.Config

  @docs_dir "docs"
  @separator_encoding "~"
  @segment_regex ~r/^[a-zA-Z0-9._-]+$/

  @spec repo_slug(String.t()) :: String.t()
  def repo_slug(workspace_path) when is_binary(workspace_path),
    do: String.replace(workspace_path, "/", @separator_encoding)

  @spec workspace_path_from_slug(String.t()) :: String.t()
  def workspace_path_from_slug(repo_slug) when is_binary(repo_slug),
    do: String.replace(repo_slug, @separator_encoding, "/")

  @spec repo_checkout(String.t(), String.t()) :: Path.t()
  def repo_checkout(project_slug, workspace_path)
      when is_binary(project_slug) and is_binary(workspace_path) do
    Config.workspace_root()
    |> Path.expand()
    |> Path.join(project_slug)
    |> Path.join(workspace_path)
  end

  @spec docs_root(String.t(), String.t()) :: Path.t()
  def docs_root(project_slug, workspace_path),
    do: repo_checkout(project_slug, workspace_path) |> Path.join(@docs_dir)

  @spec safe_relative_path([String.t()] | String.t()) ::
          {:ok, String.t()} | {:error, :kb_invalid_path}
  def safe_relative_path(segments) when is_list(segments) do
    cond do
      segments == [] -> {:error, :kb_invalid_path}
      Enum.any?(segments, &unsafe_segment?/1) -> {:error, :kb_invalid_path}
      not String.ends_with?(List.last(segments), ".md") -> {:error, :kb_invalid_path}
      true -> {:ok, Enum.join(segments, "/")}
    end
  end

  def safe_relative_path(path) when is_binary(path),
    do: path |> String.split("/", trim: false) |> safe_relative_path()

  @spec resolve_page(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_page(project_slug, workspace_path, segments) do
    with {:ok, rel} <- safe_relative_path(segments) do
      root = docs_root(project_slug, workspace_path) |> Path.expand()
      full = root |> Path.join(rel) |> Path.expand()

      if full == root or String.starts_with?(full, root <> "/") do
        {:ok, full}
      else
        {:error, :kb_invalid_path}
      end
    end
  end

  defp unsafe_segment?(segment) do
    segment in ["", ".", ".."] or
      String.contains?(segment, "\0") or
      not Regex.match?(@segment_regex, segment)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/paths_test.exs`
Expected: PASS (8 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/paths.ex elixir/test/symphony_elixir/knowledge_base/paths_test.exs
git commit -m "feat(kb): add knowledge base path resolution and validation"
```

---

## Task 2: `KnowledgeBase.MarkdownPage`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/markdown_page.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/markdown_page_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.MarkdownPageTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.MarkdownPage

  test "parses frontmatter, body, and title from frontmatter" do
    content = "---\ntitle: Architecture\norder: 10\n---\n# Heading\n\nBody text\n"

    assert {:ok, page} = MarkdownPage.parse(content)
    assert page.frontmatter["title"] == "Architecture"
    assert page.frontmatter["order"] == 10
    assert page.title == "Architecture"
    assert page.body == "# Heading\n\nBody text\n"
  end

  test "falls back to first H1 when frontmatter has no title" do
    assert {:ok, page} = MarkdownPage.parse("# Backend Guide\n\ntext")
    assert page.frontmatter == %{}
    assert page.title == "Backend Guide"
  end

  test "falls back to default_title when no frontmatter and no H1" do
    assert {:ok, page} = MarkdownPage.parse("plain text only", default_title: "guide")
    assert page.title == "guide"
  end

  test "treats empty frontmatter block as empty map" do
    assert {:ok, page} = MarkdownPage.parse("---\n---\nbody", default_title: "x")
    assert page.frontmatter == %{}
    assert page.body == "body"
  end

  test "returns error for invalid frontmatter yaml" do
    assert MarkdownPage.parse("---\n: : :\nbad\n---\nbody") == {:error, :kb_frontmatter_invalid}
  end

  test "returns error when frontmatter is not a map" do
    assert MarkdownPage.parse("---\n- a\n- b\n---\nbody") == {:error, :kb_frontmatter_invalid}
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/markdown_page_test.exs`
Expected: FAIL with module/function undefined.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.MarkdownPage do
  @moduledoc "Parses knowledge base Markdown documents (YAML frontmatter + body)."

  defstruct frontmatter: %{}, body: "", title: ""

  @type t :: %__MODULE__{frontmatter: map(), body: String.t(), title: String.t()}

  @frontmatter_regex ~r/\A---\r?\n(?<yaml>.*?)\r?\n?---\r?\n(?<body>.*)\z/s
  @h1_regex ~r/^#\s+(.+?)\s*$/

  @spec parse(String.t(), keyword()) :: {:ok, t()} | {:error, :kb_frontmatter_invalid}
  def parse(content, opts \\ []) when is_binary(content) do
    default_title = Keyword.get(opts, :default_title, "")

    case Regex.named_captures(@frontmatter_regex, content) do
      %{"yaml" => yaml, "body" => body} ->
        parse_frontmatter(yaml, body, default_title)

      nil ->
        {:ok, build(%{}, content, default_title)}
    end
  end

  defp parse_frontmatter(yaml, body, default_title) do
    case YamlElixir.read_from_string(yaml) do
      {:ok, map} when is_map(map) -> {:ok, build(map, body, default_title)}
      {:ok, nil} -> {:ok, build(%{}, body, default_title)}
      {:ok, _non_map} -> {:error, :kb_frontmatter_invalid}
      {:error, _reason} -> {:error, :kb_frontmatter_invalid}
    end
  end

  defp build(frontmatter, body, default_title) do
    %__MODULE__{
      frontmatter: frontmatter,
      body: body,
      title: resolve_title(frontmatter, body, default_title)
    }
  end

  defp resolve_title(frontmatter, body, default_title) do
    cond do
      is_binary(frontmatter["title"]) and String.trim(frontmatter["title"]) != "" ->
        String.trim(frontmatter["title"])

      title = first_h1(body) ->
        title

      true ->
        default_title
    end
  end

  defp first_h1(body) do
    body
    |> String.split("\n")
    |> Enum.find_value(fn line ->
      case Regex.run(@h1_regex, line) do
        [_, title] -> String.trim(title)
        _ -> nil
      end
    end)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/markdown_page_test.exs`
Expected: PASS (6 tests, 0 failures).

Note: if the "empty frontmatter block" test fails because `YamlElixir.read_from_string("")` returns `{:ok, nil}`, that case is already handled by the `{:ok, nil}` clause. If it instead raised, the `{:error, _}` clause would wrongly fire - in that event, special-case `String.trim(yaml) == ""` to return `build(%{}, body, default_title)` before calling YamlElixir.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/markdown_page.ex elixir/test/symphony_elixir/knowledge_base/markdown_page_test.exs
git commit -m "feat(kb): parse markdown frontmatter, body, and title"
```

---

## Task 3: `KnowledgeBase.Tree`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/tree.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/tree_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.TreeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Tree

  setup do
    root = Path.join(System.tmp_dir!(), "kb-tree-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "architecture"))
    File.mkdir_p!(Path.join(root, "assets"))
    File.write!(Path.join(root, "index.md"), "---\ntitle: Home\norder: 1\n---\n# Home\n")
    File.write!(Path.join(root, "guide.md"), "# A Guide\n")
    File.write!(Path.join(root, "architecture/backend.md"), "---\ntitle: Backend\n---\nx")
    File.write!(Path.join(root, "assets/logo.png"), "binary")
    on_exit(fn -> File.rm_rf(root) end)
    {:ok, root: root}
  end

  test "returns [] for a missing docs root" do
    assert Tree.build(Path.join(System.tmp_dir!(), "does-not-exist-#{System.unique_integer()}")) == []
  end

  test "builds a nested tree ordered by frontmatter order then title", %{root: root} do
    tree = Tree.build(root)

    names = Enum.map(tree, & &1.name)
    # index.md has order:1 so it sorts before "A Guide" (no order) and the folder
    assert "index.md" == hd(names)
    assert "guide.md" in names
    assert "architecture" in names

    folder = Enum.find(tree, &(&1.name == "architecture"))
    assert folder.type == :folder
    assert [%{type: :page, name: "backend.md", title: "Backend", path: "architecture/backend.md"}] =
             folder.children
  end

  test "excludes assets/ and dotfiles from the tree", %{root: root} do
    names = root |> Tree.build() |> Enum.map(& &1.name)
    refute "assets" in names
  end

  test "derives page title from frontmatter, H1, then humanized filename", %{root: root} do
    tree = Tree.build(root)
    assert Enum.find(tree, &(&1.name == "index.md")).title == "Home"
    assert Enum.find(tree, &(&1.name == "guide.md")).title == "A Guide"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/tree_test.exs`
Expected: FAIL with module/function undefined.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Tree do
  @moduledoc "Builds a repository-scoped page tree by walking a `docs/` directory."

  alias SymphonyElixir.KnowledgeBase.MarkdownPage

  @ignored_dirs ["assets", ".git"]
  @no_order 1_000_000

  @type node :: %{
          type: :folder | :page,
          name: String.t(),
          path: String.t(),
          title: String.t(),
          order: integer() | nil,
          children: [node()]
        }

  @spec build(Path.t()) :: [node()]
  def build(docs_root) when is_binary(docs_root) do
    if File.dir?(docs_root), do: build_dir(docs_root, ""), else: []
  end

  defp build_dir(abs_dir, rel_dir) do
    abs_dir
    |> File.ls!()
    |> Enum.reject(&ignored?/1)
    |> Enum.map(&entry(abs_dir, rel_dir, &1))
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(&{&1.order || @no_order, String.downcase(&1.title)})
  end

  defp entry(abs_dir, rel_dir, name) do
    abs = Path.join(abs_dir, name)
    rel = join_rel(rel_dir, name)

    cond do
      File.dir?(abs) ->
        %{type: :folder, name: name, path: rel, title: humanize(name), order: nil, children: build_dir(abs, rel)}

      page?(name) ->
        page_node(abs, rel, name)

      true ->
        nil
    end
  end

  defp page_node(abs, rel, name) do
    {frontmatter, title} =
      with {:ok, content} <- File.read(abs),
           {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(name)) do
        {page.frontmatter, page.title}
      else
        _ -> {%{}, default_title(name)}
      end

    %{type: :page, name: name, path: rel, title: title, order: order(frontmatter), children: []}
  end

  defp ignored?(name), do: name in @ignored_dirs or String.starts_with?(name, ".")
  defp page?(name), do: String.ends_with?(name, ".md")
  defp join_rel("", name), do: name
  defp join_rel(rel_dir, name), do: rel_dir <> "/" <> name
  defp default_title(name), do: name |> String.replace_suffix(".md", "") |> humanize()
  defp humanize(name), do: name |> String.replace(["-", "_"], " ") |> String.trim()
  defp order(%{"order" => order}) when is_integer(order), do: order
  defp order(_), do: nil
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/tree_test.exs`
Expected: PASS (4 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/tree.ex elixir/test/symphony_elixir/knowledge_base/tree_test.exs
git commit -m "feat(kb): build repository docs page tree"
```

---

## Task 4: `KnowledgeBase.RepoDocs`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/repo_docs.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/repo_docs_test.exs`

This task is the first to touch the database and `Config.workspace_root()`. The test setup migrates the DB, truncates tracker tables, and overrides the workspace root to an isolated temp directory via `TestSupport.write_workflow_file!/2` + `Workflow.set_workflow_file_path/1`.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.RepoDocsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.RepoDocs
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"},
          %{"github_full_name" => "acme/api", "workspace_path" => "services/api", "role" => "backend"}
        ],
        "setup" => %{}
      })

    File.mkdir_p!(Path.join([root, "acme", "web", "docs"]))
    {:ok, root: root}
  end

  test "lists repositories with docs detection and reversible repo_slug", %{root: _root} do
    repos = RepoDocs.list_repositories("acme")

    by_slug = Map.new(repos, &{&1.repo_slug, &1})
    assert by_slug["web"].docs_present? == true
    assert by_slug["web"].workspace_path == "web"
    assert by_slug["services~api"].docs_present? == false
    assert by_slug["services~api"].workspace_path == "services/api"
  end

  test "fetch_repository resolves by repo_slug" do
    assert {:ok, repo} = RepoDocs.fetch_repository("acme", "services~api")
    assert repo.workspace_path == "services/api"
    assert RepoDocs.fetch_repository("acme", "missing") == {:error, :repo_not_found}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-repodocs-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)

    on_exit(fn ->
      File.rm_rf(root)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
    end)

    root
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/repo_docs_test.exs`
Expected: FAIL with `module SymphonyElixir.KnowledgeBase.RepoDocs is not available`.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.RepoDocs do
  @moduledoc "Lists a project's repositories and detects each repository's `docs/` folder."

  alias SymphonyElixir.KnowledgeBase.Paths
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Repository

  @type repo_info :: %{
          repo_slug: String.t(),
          workspace_path: String.t(),
          github_full_name: String.t() | nil,
          role: String.t() | nil,
          docs_present?: boolean()
        }

  @spec list_repositories(String.t()) :: [repo_info()]
  def list_repositories(project_slug) when is_binary(project_slug) do
    project_slug
    |> Context.list_repositories()
    |> Enum.map(&describe(project_slug, &1))
  end

  @spec fetch_repository(String.t(), String.t()) ::
          {:ok, Repository.t()} | {:error, :repo_not_found}
  def fetch_repository(project_slug, repo_slug)
      when is_binary(project_slug) and is_binary(repo_slug) do
    workspace_path = Paths.workspace_path_from_slug(repo_slug)

    project_slug
    |> Context.list_repositories()
    |> Enum.find(fn repo -> repo.workspace_path == workspace_path end)
    |> case do
      %Repository{} = repo -> {:ok, repo}
      nil -> {:error, :repo_not_found}
    end
  end

  defp describe(project_slug, %Repository{} = repo) do
    %{
      repo_slug: Paths.repo_slug(repo.workspace_path),
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      role: repo.role,
      docs_present?: File.dir?(Paths.docs_root(project_slug, repo.workspace_path))
    }
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/repo_docs_test.exs`
Expected: PASS (2 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/repo_docs.ex elixir/test/symphony_elixir/knowledge_base/repo_docs_test.exs
git commit -m "feat(kb): list project repositories and detect docs folders"
```

---

## Task 5: `KnowledgeBase` context - `project_overview/1`, `repo_tree/2`, `read_page/3`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBaseTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"}
        ],
        "setup" => %{}
      })

    docs = Path.join([root, "acme", "web", "docs"])
    File.mkdir_p!(Path.join(docs, "architecture"))
    File.write!(Path.join(docs, "index.md"), "---\ntitle: Home\n---\n# Home\n")
    File.write!(Path.join(docs, "architecture/backend.md"), "---\ntitle: Backend\n---\n# B\n\nbody\n")
    File.write!(Path.join(docs, "broken.md"), "---\n- not\n- a map\n---\nx")
    {:ok, root: root, docs: docs}
  end

  test "project_overview returns repositories with docs status" do
    assert {:ok, overview} = KnowledgeBase.project_overview("acme")
    assert overview.project.slug == "acme"
    assert [%{repo_slug: "web", docs_present?: true}] = overview.repositories
  end

  test "project_overview returns error for unknown project" do
    assert KnowledgeBase.project_overview("nope") == {:error, :project_not_found}
  end

  test "repo_tree returns the repository summary and tree" do
    assert {:ok, result} = KnowledgeBase.repo_tree("acme", "web")
    assert result.repository.repo_slug == "web"
    assert result.docs_present == true
    assert Enum.any?(result.tree, &(&1.name == "index.md"))
  end

  test "repo_tree errors for unknown repo and project" do
    assert KnowledgeBase.repo_tree("acme", "missing") == {:error, :repo_not_found}
    assert KnowledgeBase.repo_tree("nope", "web") == {:error, :project_not_found}
  end

  test "read_page returns frontmatter, title, body, and content" do
    assert {:ok, page} = KnowledgeBase.read_page("acme", "web", ["architecture", "backend.md"])
    assert page.title == "Backend"
    assert page.path == "architecture/backend.md"
    assert page.frontmatter["title"] == "Backend"
    assert page.body =~ "body"
    assert page.content =~ "# B"
  end

  test "read_page validates path and missing files" do
    assert KnowledgeBase.read_page("acme", "web", ["..", "x.md"]) == {:error, :kb_invalid_path}
    assert KnowledgeBase.read_page("acme", "web", ["nope.md"]) == {:error, :kb_page_not_found}
    assert KnowledgeBase.read_page("acme", "web", ["broken.md"]) == {:error, :kb_frontmatter_invalid}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-context-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)
    on_exit(fn -> File.rm_rf(root); Application.delete_env(:symphony_elixir, :workflow_file_path) end)
    root
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs`
Expected: FAIL with `module SymphonyElixir.KnowledgeBase is not available`.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase do
  @moduledoc """
  Public read API for the Git-backed knowledge base.

  A project's knowledge base is a composition of per-repository `docs/` trees.
  Every page is addressed by `(repository, path-within-docs)`; there is no shared
  file root across repositories.
  """

  alias SymphonyElixir.KnowledgeBase.{MarkdownPage, Paths, RepoDocs, Tree}
  alias SymphonyElixir.LocalTracker.Context

  @type error ::
          :project_not_found
          | :repo_not_found
          | :kb_invalid_path
          | :kb_page_not_found
          | :kb_frontmatter_invalid

  @spec project_overview(String.t()) :: {:ok, map()} | {:error, :project_not_found}
  def project_overview(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      {:ok,
       %{
         project: %{slug: project.slug, name: project.name},
         repositories: RepoDocs.list_repositories(project_slug)
       }}
    end
  end

  @spec repo_tree(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def repo_tree(project_slug, repo_slug) when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug) do
      docs_root = Paths.docs_root(project_slug, repo.workspace_path)

      {:ok,
       %{
         repository: repo_summary(repo),
         docs_present: File.dir?(docs_root),
         tree: Tree.build(docs_root)
       }}
    end
  end

  @spec read_page(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def read_page(project_slug, repo_slug, rel)
      when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, abs} <- Paths.resolve_page(project_slug, repo.workspace_path, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, content} <- read_file(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(rel)) do
      {:ok,
       %{
         repo_slug: Paths.repo_slug(repo.workspace_path),
         path: normalize_rel(rel),
         title: page.title,
         frontmatter: page.frontmatter,
         body: page.body,
         content: content
       }}
    end
  end

  defp ensure_regular_file(abs) do
    case File.lstat(abs) do
      {:ok, %File.Stat{type: :regular}} -> :ok
      {:ok, %File.Stat{type: :symlink}} -> {:error, :kb_invalid_path}
      _ -> {:error, :kb_page_not_found}
    end
  end

  defp read_file(abs) do
    case File.read(abs) do
      {:ok, content} -> {:ok, content}
      {:error, _reason} -> {:error, :kb_page_not_found}
    end
  end

  defp repo_summary(repo) do
    %{
      repo_slug: Paths.repo_slug(repo.workspace_path),
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      role: repo.role
    }
  end

  defp normalize_rel(rel) when is_list(rel), do: Enum.join(rel, "/")
  defp normalize_rel(rel) when is_binary(rel), do: rel

  defp default_title(rel) do
    rel |> normalize_rel() |> Path.basename() |> String.replace_suffix(".md", "")
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs`
Expected: PASS (6 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base.ex elixir/test/symphony_elixir/knowledge_base_test.exs
git commit -m "feat(kb): add knowledge base read context (overview, tree, page)"
```

---

## Task 6: TrackerErrors clauses for KB errors

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex` (insert new clauses immediately BEFORE the catch-all clauses `def render(conn, message) when is_binary(message)` near line 366)
- Test: `elixir/test/symphony_elixir_web/tracker_errors_test.exs` (create if absent; otherwise append)

`:project_not_found` (404) and `:repo_not_found` (404) already exist and are reused. Only the three KB-specific atoms are added.

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixirWeb.TrackerErrorsTest do
  use ExUnit.Case, async: true
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixirWeb.TrackerErrors

  test "maps kb_invalid_path to 422" do
    conn = TrackerErrors.render(build_conn(), :kb_invalid_path)
    assert conn.status == 422
    assert Jason.decode!(conn.resp_body)["error"]["code"] == "kb_invalid_path"
  end

  test "maps kb_page_not_found to 404" do
    conn = TrackerErrors.render(build_conn(), :kb_page_not_found)
    assert conn.status == 404
    assert Jason.decode!(conn.resp_body)["error"]["code"] == "kb_page_not_found"
  end

  test "maps kb_frontmatter_invalid to 422" do
    conn = TrackerErrors.render(build_conn(), :kb_frontmatter_invalid)
    assert conn.status == 422
    assert Jason.decode!(conn.resp_body)["error"]["code"] == "kb_frontmatter_invalid"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: FAIL - the atoms currently fall through to the catch-all (`request_failed`, 500), so the code/status assertions fail.

- [ ] **Step 3: Write minimal implementation**

Insert these clauses just before `def render(conn, message) when is_binary(message), do: server_error(conn, message)`:

```elixir
  def render(conn, :kb_invalid_path),
    do:
      error(
        conn,
        422,
        "kb_invalid_path",
        dgettext("errors", "Knowledge base path must be a markdown file under docs/.")
      )

  def render(conn, :kb_page_not_found),
    do: not_found(conn, "kb_page_not_found", dgettext("errors", "Knowledge base page not found"))

  def render(conn, :kb_frontmatter_invalid),
    do:
      error(
        conn,
        422,
        "kb_frontmatter_invalid",
        dgettext("errors", "Knowledge base page frontmatter is invalid")
      )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: PASS (3 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/tracker_errors_test.exs
git commit -m "feat(kb): add tracker error clauses for knowledge base"
```

---

## Task 7: Controller + routes (project overview, repo tree, page read)

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex` (add 3 routes inside the existing `scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do pipe_through(:tracker_api)` block)
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs`

- [ ] **Step 1: Add the routes**

In `router.ex`, inside the `:tracker_api` scope (e.g. directly after the `clone_jobs` routes near the end of that block), add:

```elixir
    get("/projects/:project_slug/kb", KnowledgeBaseController, :project_overview)
    get("/projects/:project_slug/kb/repos/:repo", KnowledgeBaseController, :repo_tree)
    get("/projects/:project_slug/kb/repos/:repo/pages/*path", KnowledgeBaseController, :show_page)
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseControllerTest do
  use ExUnit.Case, async: false
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    token_env = SymphonyElixir.Config.local_api_token_env()
    previous_token = System.get_env(token_env)
    System.put_env(token_env, "secret")
    on_exit(fn -> restore_env(token_env, previous_token) end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"}
        ],
        "setup" => %{}
      })

    docs = Path.join([root, "acme", "web", "docs"])
    File.mkdir_p!(Path.join(docs, "architecture"))
    File.write!(Path.join(docs, "index.md"), "---\ntitle: Home\n---\n# Home\n")
    File.write!(Path.join(docs, "architecture/backend.md"), "---\ntitle: Backend\n---\n# B\n")
    :ok
  end

  test "rejects missing tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/projects/acme/kb")
    assert json_response(conn, 401)
  end

  test "GET project overview lists repositories" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb")
    body = json_response(conn, 200)
    assert body["data"]["project"]["slug"] == "acme"
    assert [%{"repo_slug" => "web", "docs_present?" => true}] = body["data"]["repositories"]
  end

  test "GET repo tree returns the docs tree" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web")
    body = json_response(conn, 200)
    assert body["data"]["repository"]["repo_slug"] == "web"
    names = Enum.map(body["data"]["tree"], & &1["name"])
    assert "index.md" in names
    assert "architecture" in names
  end

  test "GET page returns frontmatter, title, and body" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/architecture/backend.md")
    body = json_response(conn, 200)
    assert body["data"]["title"] == "Backend"
    assert body["data"]["path"] == "architecture/backend.md"
  end

  test "GET unknown repo returns 404" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/missing")
    assert json_response(conn, 404)["error"]["code"] == "repo_not_found"
  end

  test "GET traversal path returns 422" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/secret.txt")
    assert json_response(conn, 422)["error"]["code"] == "kb_invalid_path"
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-ctrl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)
    on_exit(fn -> File.rm_rf(root); Application.delete_env(:symphony_elixir, :workflow_file_path) end)
    root
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs`
Expected: FAIL - controller module not available / routes raise no-route or compile error.

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseController do
  @moduledoc "Read-only knowledge base endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixirWeb.TrackerErrors

  @spec project_overview(Conn.t(), map()) :: Conn.t()
  def project_overview(conn, %{"project_slug" => project_slug}) do
    case KnowledgeBase.project_overview(project_slug) do
      {:ok, overview} -> json(conn, %{data: overview})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec repo_tree(Conn.t(), map()) :: Conn.t()
  def repo_tree(conn, %{"project_slug" => project_slug, "repo" => repo_slug}) do
    case KnowledgeBase.repo_tree(project_slug, repo_slug) do
      {:ok, tree} -> json(conn, %{data: tree})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec show_page(Conn.t(), map()) :: Conn.t()
  def show_page(conn, %{"project_slug" => project_slug, "repo" => repo_slug, "path" => path}) do
    case KnowledgeBase.read_page(project_slug, repo_slug, path) do
      {:ok, page} -> json(conn, %{data: page})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs`
Expected: PASS (6 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs
git commit -m "feat(kb): add read-only knowledge base API endpoints"
```

---

## Task 8: Milestone verification (format, compile warnings, full KB suite)

**Files:** none (verification only)

- [ ] **Step 1: Format check**

Run: `mix format --check-formatted`
Expected: exit 0 (no files need formatting). If it reports files, run `mix format` and re-commit.

- [ ] **Step 2: Compile with warnings as errors**

Run: `mix compile --warnings-as-errors`
Expected: compiles cleanly, exit 0.

- [ ] **Step 3: Run the full knowledge base suite**

Run: `mix test test/symphony_elixir/knowledge_base test/symphony_elixir/knowledge_base_test.exs test/symphony_elixir_web/controllers/tracker/knowledge_base_controller_test.exs test/symphony_elixir_web/tracker_errors_test.exs`
Expected: all tests pass, 0 failures.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(kb): format and warnings cleanup for milestone 1"
```

(Skip if there is nothing to commit.)

---

## Self-Review

**Spec coverage (M1 portion of `2026-06-25-knowledge-base-design.md`):**

| Spec requirement | Task |
|---|---|
| D1 Git/docs is the source of truth; derived data only | All tasks read from disk; no DB tables added (Tasks 1-7) |
| D2 / D2a Repository is a first-class scope; addressing by `(repository, path)` | Tasks 1 (`repo_slug`), 4 (`fetch_repository`), 5 (`repo_tree`/`read_page`), 7 (routes include `:repo`) |
| D5 Metadata in frontmatter (title/order) | Task 2 (`MarkdownPage`), Task 3 (`Tree` order/title) |
| Project KB overview links each repository's docs + per-repo status | Task 5 (`project_overview`), Task 7 (`/kb`) |
| Repository-grouped tree (sidebar source data) | Task 3 (`Tree`), Task 5 (`repo_tree`), Task 7 (`/kb/repos/:repo`) |
| Read page by `(repository, path)` | Task 5 (`read_page`), Task 7 (`/kb/repos/:repo/pages/*path`) |
| Section 8 endpoints: `GET /projects/:slug/kb`, `/kb/repos/:repo`, `/kb/repos/:repo/pages/*path` | Task 7 |
| Section 8 repo identifiers are validated slugs, not raw filesystem paths | Task 1 (`repo_slug`/`workspace_path_from_slug`), Task 4 (lookup by slug) |
| Section 11 failure states: `invalid_path`, `docs_missing`, `frontmatter_invalid`, page not found | Task 1 (`:kb_invalid_path`), Task 5 (`docs_present` flag, `:kb_page_not_found`, `:kb_frontmatter_invalid`), Task 6 (HTTP mapping) |
| Section 12 security: stay under docs root, reject `..`/empty/absolute, no symlink escape | Task 1 (`safe_relative_path` + prefix check), Task 5 (`ensure_regular_file` rejects symlinks) |

**Deferred to later milestones (intentionally out of M1 scope):** writing/auto-commit (M2), assets (M2), full-text search/FTS5 (M3), git sync + PR/auto-merge (M4), `symphony-kb` personal repo + home generator (M5), all frontend (M6), assistant tools (M7). The generated project default/home **page rendering** is M6; M1 only exposes the per-repository data the home view will consume.

**Placeholder scan:** No `TBD`/`TODO`/"implement later". Every code-changing step contains complete code. Test steps contain real assertions. The single conditional note (Task 2, Step 4) is a concrete fallback instruction, not a placeholder.

**Type consistency:**
- `repo_slug` encoding (`/` -> `~`) is defined once in `Paths` and reused by `RepoDocs`, `KnowledgeBase`, and routes.
- Error atoms `:kb_invalid_path | :kb_page_not_found | :kb_frontmatter_invalid` are produced by `Paths`/`MarkdownPage`/`KnowledgeBase` and mapped by `TrackerErrors` (Task 6); `:project_not_found`/`:repo_not_found` reuse existing clauses.
- `Tree.node` shape (`type`, `name`, `path`, `title`, `order`, `children`) is the same structure returned inside `repo_tree` and consumed by the frontend in M6.
- `MarkdownPage.t` (`frontmatter`, `body`, `title`) is consumed by both `Tree` (Task 3) and `KnowledgeBase.read_page` (Task 5).

---

## Execution handoff (Cursor)

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-knowledge-base-01-backend-read-foundation.md`. Two execution options:**

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-01-backend-read-foundation.md`
```

1. **Task-per-session (recommended)** - one plan task (or small batch) per subagent or fresh focus, review between tasks.
2. **Inline** - run tasks in this conversation with explicit checkpoints after each task.
