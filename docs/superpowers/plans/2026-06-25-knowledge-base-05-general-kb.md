# Knowledge Base - Milestone 5: General User KB (`symphony-kb`) + Home Generator Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task, or **(B)** inline execution with checkpoints. All Elixir commands run from `elixir/`. Depends on M1-M4 merged.

**Goal:** Give the authenticated user a personal, cross-project knowledge base stored in a private GitHub repository named `symphony-kb` in their personal account. The general KB has a regenerable home page that links to every Symphony project's KB. It reuses the same read/write/search/sync machinery as project KBs, scoped under the `@user` project sentinel.

**Architecture:** A new `GitHub.Repositories.ensure/2` finds-or-creates the private `symphony-kb` repo (REST `POST /user/repos`, login via `GitHub.Viewer`). `KnowledgeBase.GeneralKb` ensures a local clone at `<workspace_root>/.symphony-kb`, then routes all reads/writes through the existing `Workspace.ensure/2` + `Writer` + `Indexer` + `Search` using the constant scope `project_slug = "@user"`, `repo_slug = "@user~symphony-kb"`. `KnowledgeBase.HomePage.render/1` is a pure function that turns the list of tracker projects into a Markdown home page (`docs/index.md`, frontmatter `generated: true`), which the context writes (and re-writes) via `Writer`. New `/kb/*` endpoints expose connect, tree, read, write, regenerate-home; the `GET /kb/search` from M3 now returns real results because `@user` pages are indexed.

**Tech Stack:** Elixir/Phoenix, `SymphonyElixir.GitHub.Client`/`Viewer`, `LocalTracker.Git.clone/3`, existing KB modules (`Workspace`, `Writer`, `Indexer`, `Search`, `Tree`, `MarkdownPage`).

---

## Plan sequence

M1 read -> M2 editing/auto-commit -> M3 search -> M4 git flows -> **M5 general KB (this plan)** -> M6 frontend -> M7 assistant tools. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md` (Section 4 general KB, Section 6 home page).

---

## File structure (M5)

Create:
- `elixir/lib/symphony_elixir/github/repositories.ex` - find-or-create private repo for the viewer.
- `elixir/lib/symphony_elixir/knowledge_base/home_page.ex` - pure Markdown home-page renderer.
- `elixir/lib/symphony_elixir/knowledge_base/general_kb.ex` - ensure/clone + read/write/search/regenerate under `@user`.
- Tests:
  - `elixir/test/symphony_elixir/github/repositories_test.exs`
  - `elixir/test/symphony_elixir/knowledge_base/home_page_test.exs`
  - `elixir/test/symphony_elixir/knowledge_base/general_kb_test.exs`
  - `elixir/test/symphony_elixir_web/controllers/tracker/general_knowledge_base_controller_test.exs`

Modify:
- `elixir/lib/symphony_elixir/knowledge_base/paths.ex` - add `general_kb_checkout/0` and `@user_scope`/`@general_repo_slug` constants.
- `elixir/lib/symphony_elixir/knowledge_base.ex` - delegate general-KB functions; ensure `search_general/2` hits the `@user` scope.
- `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex` - add general-KB actions.
- `elixir/lib/symphony_elixir_web/router.ex` - add `/kb/*` routes.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` - add `:kb_repo_create_failed`, `:kb_not_connected`.

Locked decisions:
- Repo name `symphony-kb`, `private: true`, `auto_init: true` (so it has a default branch + initial commit to clone).
- Scope constants: `project_slug = "@user"`, `repo_slug = "@user~symphony-kb"`. The `@` prefix cannot collide with real project slugs (slugs are alphanumeric/hyphen).
- Local clone at `<workspace_root>/.symphony-kb`; the `symphony-docs` worktree lives under it like any repo.
- Home page is fully generated/overwritten on regenerate (no manual-edit preservation in MVP); it lists projects from `LocalTracker.Context.list_projects/0`.
- General KB sync (PR/auto-merge to its own default branch) reuses M4's flow with `project_slug = "@user"`; wiring the worker is included but optional to trigger.

---

## Task 1: `GitHub.Repositories.ensure/2`

**Files:**
- Create: `elixir/lib/symphony_elixir/github/repositories.ex`
- Test: `elixir/test/symphony_elixir/github/repositories_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.GitHub.RepositoriesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Repositories

  defmodule StubMissing do
    def rest_get("/repos/octocat/symphony-kb", _), do: {:ok, %{status: 404, body: %{}}}
    def rest_post("/user/repos", body, _) do
      send(self(), {:created, body})
      {:ok, %{status: 201, body: %{"full_name" => "octocat/symphony-kb", "clone_url" => "https://github.com/octocat/symphony-kb.git", "default_branch" => "main", "private" => true}}}
    end
  end

  defmodule StubExisting do
    def rest_get("/repos/octocat/symphony-kb", _),
      do: {:ok, %{status: 200, body: %{"full_name" => "octocat/symphony-kb", "clone_url" => "https://github.com/octocat/symphony-kb.git", "default_branch" => "main", "private" => true}}}
  end

  test "creates the private repo when it does not exist" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubMissing)
    assert repo.full_name == "octocat/symphony-kb"
    assert repo.created == true
    assert_received {:created, %{"name" => "symphony-kb", "private" => true, "auto_init" => true}}
  end

  test "returns the existing repo without creating" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubExisting)
    assert repo.created == false
    assert repo.clone_url =~ "symphony-kb.git"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/github/repositories_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.GitHub.Repositories do
  @moduledoc """
  Finds or creates a repository in the authenticated user's personal account.
  Used to provision the private `symphony-kb` knowledge base repository.
  """

  alias SymphonyElixir.GitHub.{Client, Viewer}

  @type repo :: %{full_name: String.t(), clone_url: String.t(), default_branch: String.t(), created: boolean()}

  @spec ensure(String.t(), keyword()) :: {:ok, repo()} | {:error, term()}
  def ensure(name, opts \\ []) when is_binary(name) do
    client = Keyword.get(opts, :client, Client)

    with {:ok, login} <- resolve_login(opts) do
      case client.rest_get("/repos/#{login}/#{name}", []) do
        {:ok, %{status: 200, body: body}} -> {:ok, to_repo(body, false)}
        {:ok, %{status: 404}} -> create(client, name)
        {:ok, %{status: s}} -> {:error, {:github_api_status, s}}
        error -> error
      end
    end
  end

  defp create(client, name) do
    payload = %{"name" => name, "private" => true, "auto_init" => true, "description" => "Symphony knowledge base"}

    case client.rest_post("/user/repos", payload, []) do
      {:ok, %{status: s, body: body}} when s in 200..299 -> {:ok, to_repo(body, true)}
      {:ok, %{status: s}} -> {:error, {:kb_repo_create_failed, s}}
      error -> error
    end
  end

  defp resolve_login(opts) do
    case Keyword.get(opts, :login) do
      login when is_binary(login) and login != "" -> {:ok, login}
      _ -> Viewer.resolve_login(opts)
    end
  end

  defp to_repo(body, created) do
    %{
      full_name: body["full_name"],
      clone_url: body["clone_url"],
      default_branch: body["default_branch"] || "main",
      created: created
    }
  end
end
```

Confirm `Viewer.resolve_login/1` arity/return (`{:ok, login}`); if it is `resolve_login/0`, adapt `resolve_login/1` accordingly. The tests inject `login:` so they don't depend on `Viewer`.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/github/repositories_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/github/repositories.ex elixir/test/symphony_elixir/github/repositories_test.exs
git commit -m "feat(github): find-or-create a private user repository"
```

---

## Task 2: `KnowledgeBase.HomePage` (pure renderer)

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/home_page.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/home_page_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.HomePageTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{HomePage, MarkdownPage}

  test "render produces a generated home page listing projects" do
    out = HomePage.render([%{name: "Acme", slug: "acme"}, %{name: "Beta", slug: "beta"}])

    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.frontmatter["generated"] == true
    assert page.frontmatter["title"] == "Knowledge Base"
    assert page.body =~ "- [Acme](/projects/acme/kb)"
    assert page.body =~ "- [Beta](/projects/beta/kb)"
  end

  test "render handles an empty project list with a placeholder" do
    out = HomePage.render([])
    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.body =~ "No projects yet"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/home_page_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.HomePage do
  @moduledoc "Renders the generated general-KB home page that links to project KBs."

  alias SymphonyElixir.KnowledgeBase.Frontmatter

  @spec render([%{name: String.t(), slug: String.t()}]) :: String.t()
  def render(projects) when is_list(projects) do
    Frontmatter.serialize(%{"title" => "Knowledge Base", "generated" => true}, body(projects))
  end

  defp body([]), do: heading() <> "_No projects yet. Create a project to see it here._\n"

  defp body(projects) do
    items = Enum.map_join(projects, "\n", fn %{name: name, slug: slug} -> "- [#{name}](/projects/#{slug}/kb)" end)
    heading() <> items <> "\n"
  end

  defp heading, do: "# Knowledge Base\n\nWelcome to your personal knowledge base.\n\n## Projects\n\n"
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/home_page_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/home_page.ex elixir/test/symphony_elixir/knowledge_base/home_page_test.exs
git commit -m "feat(kb): render the general KB home page"
```

---

## Task 3: `KnowledgeBase.GeneralKb` context

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base/paths.ex` (constants + `general_kb_checkout/0`)
- Create: `elixir/lib/symphony_elixir/knowledge_base/general_kb.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/general_kb_test.exs`

All side effects (login, repo ensure, clone) are injectable so tests run offline against a local bare repo.

- [ ] **Step 1: Add Paths constants/helpers**

```elixir
  @user_scope "@user"
  @general_repo_slug "@user~symphony-kb"

  @spec user_scope() :: String.t()
  def user_scope, do: @user_scope

  @spec general_repo_slug() :: String.t()
  def general_repo_slug, do: @general_repo_slug

  @spec general_kb_checkout() :: Path.t()
  def general_kb_checkout, do: Path.join(SymphonyElixir.Config.workspace_root(), ".symphony-kb")
```

(Confirm `Config.workspace_root/0` exists - it was used in M1 path resolution.)

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.GeneralKbTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{GeneralKb, PageRecord, Paths}
  alias SymphonyElixir.Repo

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0]

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    root = Path.join(System.tmp_dir!(), "kb-gen-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    Application.put_env(:symphony_elixir, :workspace_root_override, root)
    on_exit(fn -> File.rm_rf(root); Application.delete_env(:symphony_elixir, :workspace_root_override) end)

    # Build a local "remote" the clone step can copy from (offline).
    origin = Path.join(root, "origin")
    File.mkdir_p!(Path.join(origin, "docs"))
    File.write!(Path.join(origin, "docs/keep.md"), "---\ntitle: Keep\n---\n# Keep\n")
    sh(origin, ["init", "-q", "-b", "main"])
    sh(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"])

    deps = [
      ensure_repo: fn -> {:ok, %{full_name: "octocat/symphony-kb", clone_url: origin, default_branch: "main", created: false}} end,
      clone: fn _clone_url, dest -> {_o, 0} = System.cmd("git", ["clone", "-q", origin, dest], stderr_to_stdout: true); {:ok, dest} end
    ]

    {:ok, deps: deps}
  end

  test "connect clones the repo and exposes the tree", %{deps: deps} do
    assert {:ok, _} = GeneralKb.connect(deps)
    assert {:ok, overview} = GeneralKb.overview(deps)
    assert Enum.any?(overview.tree, &(&1.path == "keep.md"))
  end

  test "regenerate_home writes a generated index linking known projects", %{deps: deps} do
    {:ok, _} = GeneralKb.connect(deps)
    projects_fun = fn -> [%{name: "Acme", slug: "acme"}] end
    assert {:ok, result} = GeneralKb.regenerate_home(Keyword.put(deps, :projects, projects_fun))
    assert result.path == "index.md"

    {:ok, page} = GeneralKb.read_page("index.md", deps)
    assert page.body =~ "[Acme](/projects/acme/kb)"
  end

  test "write_page persists and indexes a general KB page", %{deps: deps} do
    {:ok, _} = GeneralKb.connect(deps)
    {:ok, _} = GeneralKb.write_page("notes/idea.md", %{frontmatter: %{"title" => "Idea"}, body: "a wombat plan"}, deps)

    assert Enum.any?(Repo.all(PageRecord), &(&1.project_slug == Paths.user_scope() and &1.path == "notes/idea.md"))
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
```

(If `Config.workspace_root/0` does not read a `:workspace_root_override`, set the env key it actually reads; reuse the same isolation helper M1 used in `knowledge_base_test.exs`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/general_kb_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.GeneralKb do
  @moduledoc """
  The personal, cross-project knowledge base backed by the user's private
  `symphony-kb` repository. Reuses the shared KB read/write/search machinery
  under the `@user` scope.
  """

  alias SymphonyElixir.GitHub.Repositories
  alias SymphonyElixir.KnowledgeBase.{HomePage, Indexer, MarkdownPage, Paths, Search, Tree, Workspace, Writer}
  alias SymphonyElixir.LocalTracker.Context

  @repo_name "symphony-kb"

  @spec connect(keyword()) :: {:ok, map()} | {:error, term()}
  def connect(deps \\ []) do
    checkout = Paths.general_kb_checkout()

    cond do
      File.dir?(Path.join(checkout, ".git")) -> Workspace.ensure(checkout)
      true -> clone_and_open(checkout, deps)
    end
  end

  @spec overview(keyword()) :: {:ok, map()} | {:error, term()}
  def overview(deps \\ []) do
    with {:ok, ws} <- connect(deps) do
      {:ok, %{connected: true, tree: Tree.build(ws.docs_root)}}
    end
  end

  @spec read_page(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def read_page(rel, deps \\ []) do
    with {:ok, ws} <- connect(deps),
         {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, String.split(rel, "/")),
         {:ok, content} <- File.read(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: Path.basename(rel, ".md")) do
      {:ok, %{path: rel, title: page.title, frontmatter: page.frontmatter, body: page.body, markdown: content}}
    end
  end

  @spec write_page(String.t(), %{frontmatter: map(), body: String.t()}, keyword()) :: {:ok, map()} | {:error, term()}
  def write_page(rel, page, deps \\ []) do
    with {:ok, ws} <- connect(deps),
         {:ok, result} <- Writer.write_page(ws, String.split(rel, "/"), page, push: false) do
      content = SymphonyElixir.KnowledgeBase.Frontmatter.serialize(page.frontmatter, page.body)
      _ = Indexer.index_page(Paths.user_scope(), Paths.general_repo_slug(), result.path, content)
      {:ok, result}
    end
  end

  @spec regenerate_home(keyword()) :: {:ok, map()} | {:error, term()}
  def regenerate_home(deps \\ []) do
    projects_fun = Keyword.get(deps, :projects, &default_projects/0)
    projects = projects_fun.()
    markdown = HomePage.render(projects)

    case MarkdownPage.parse(markdown) do
      {:ok, page} -> write_page("index.md", %{frontmatter: page.frontmatter, body: page.body}, deps)
      error -> error
    end
  end

  @spec search(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def search(query, opts \\ []), do: Search.search_global(Paths.user_scope(), query, opts)

  defp clone_and_open(checkout, deps) do
    ensure_repo = Keyword.get(deps, :ensure_repo, &default_ensure_repo/0)
    clone = Keyword.get(deps, :clone, &default_clone/2)

    with {:ok, repo} <- ensure_repo.(),
         {:ok, _} <- clone.(repo.clone_url, checkout) do
      Workspace.ensure(checkout)
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp default_ensure_repo, do: Repositories.ensure(@repo_name)
  defp default_clone(clone_url, dest), do: SymphonyElixir.LocalTracker.Git.clone(clone_url, dest, nil)
  defp default_projects, do: Enum.map(Context.list_projects(), fn p -> %{name: p.name, slug: p.slug} end)
end
```

Confirm `LocalTracker.Git.clone/3` arity/signature (M1 explore showed `clone(url, dest, branch)`); adjust if different. `Tree.build/1` and `Paths.resolve_page_in/2` come from M1/M2.

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/general_kb_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/general_kb.ex elixir/lib/symphony_elixir/knowledge_base/paths.ex elixir/test/symphony_elixir/knowledge_base/general_kb_test.exs
git commit -m "feat(kb): general user knowledge base backed by symphony-kb repo"
```

---

## Task 4: General KB endpoints + routes + context delegation

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base.ex` (delegate; ensure `search_general/2` uses `@user` scope)
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/general_knowledge_base_controller_test.exs`

- [ ] **Step 1: Add context delegations**

```elixir
  alias SymphonyElixir.KnowledgeBase.GeneralKb

  @spec general_overview() :: {:ok, map()} | {:error, error()}
  def general_overview, do: GeneralKb.overview()

  @spec general_read_page(String.t()) :: {:ok, map()} | {:error, error()}
  def general_read_page(rel), do: GeneralKb.read_page(rel)

  @spec general_write_page(String.t(), map()) :: {:ok, map()} | {:error, error()}
  def general_write_page(rel, page), do: GeneralKb.write_page(rel, page)

  @spec general_regenerate_home() :: {:ok, map()} | {:error, error()}
  def general_regenerate_home, do: GeneralKb.regenerate_home()

  @spec general_connect() :: {:ok, map()} | {:error, error()}
  def general_connect, do: GeneralKb.connect()

  @spec search_general(String.t(), keyword()) :: {:ok, [map()]} | {:error, error()}
  def search_general(query, opts \\ []), do: GeneralKb.search(query, opts)
```

(Replace the M3 placeholder `search_general/2` with this real one.)

- [ ] **Step 2: Add routes** (before the project `/kb` routes so `/kb/search` etc. resolve)

```elixir
    post("/kb/connect", KnowledgeBaseController, :general_connect)
    get("/kb", KnowledgeBaseController, :general_overview)
    get("/kb/pages/*path", KnowledgeBaseController, :general_show_page)
    put("/kb/pages/*path", KnowledgeBaseController, :general_save_page)
    post("/kb/home", KnowledgeBaseController, :general_regenerate_home)
```

(Keep the existing `get("/kb/search", ...)` from M3.)

- [ ] **Step 3: Add error clauses**

```elixir
  def render(conn, :kb_not_connected),
    do: error(conn, 409, "kb_not_connected", dgettext("errors", "The general knowledge base is not connected yet."))

  def render(conn, {:kb_repo_create_failed, _status}),
    do: error(conn, 502, "kb_repo_create_failed", dgettext("errors", "Failed to create the symphony-kb repository."))
```

- [ ] **Step 4: Write the failing test** (inject deps via `Application.put_env` test hook, or test the connect/overview/home/read happy path using a local-origin fixture identical to the GeneralKb test; wire the controller to call the context which uses default deps - so for the controller test, point `ensure_repo`/`clone` through an application-level override the context reads).

To keep the controller testable offline, add an optional dependency override the context reads:

```elixir
  defp general_deps, do: Application.get_env(:symphony_elixir, :kb_general_deps, [])
```

and pass `general_deps()` into `GeneralKb.*` calls. The test sets `Application.put_env(:symphony_elixir, :kb_general_deps, deps)` with the local-origin `ensure_repo`/`clone` stubs.

```elixir
  test "POST connect then GET overview returns the tree" do
    assert response(post(authorized_conn(), "/api/tracker/v1/kb/connect"), 200)
    conn = get(authorized_conn(), "/api/tracker/v1/kb")
    assert json_response(conn, 200)["data"]["connected"] == true
  end

  test "POST home regenerates the index page" do
    post(authorized_conn(), "/api/tracker/v1/kb/connect")
    conn = post(authorized_conn(), "/api/tracker/v1/kb/home")
    assert json_response(conn, 200)["data"]["path"] == "index.md"
  end

  test "PUT then GET a general page round-trips" do
    post(authorized_conn(), "/api/tracker/v1/kb/connect")
    put(authorized_conn(), "/api/tracker/v1/kb/pages/notes/a.md", %{"frontmatter" => %{"title" => "A"}, "body" => "hello aardvark"})
    conn = get(authorized_conn(), "/api/tracker/v1/kb/pages/notes/a.md")
    assert json_response(conn, 200)["data"]["body"] =~ "aardvark"
  end
```

- [ ] **Step 5: Implement controller actions**

```elixir
  @spec general_connect(Conn.t(), map()) :: Conn.t()
  def general_connect(conn, _params) do
    case KnowledgeBase.general_connect() do
      {:ok, _} -> json(conn, %{data: %{connected: true}})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_overview(Conn.t(), map()) :: Conn.t()
  def general_overview(conn, _params) do
    case KnowledgeBase.general_overview() do
      {:ok, overview} -> json(conn, %{data: overview})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_show_page(Conn.t(), map()) :: Conn.t()
  def general_show_page(conn, %{"path" => path}) do
    case KnowledgeBase.general_read_page(Enum.join(List.wrap(path), "/")) do
      {:ok, page} -> json(conn, %{data: page})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_save_page(Conn.t(), map()) :: Conn.t()
  def general_save_page(conn, %{"path" => path} = params) do
    page = %{frontmatter: Map.get(params, "frontmatter", %{}) || %{}, body: to_string(Map.get(params, "body", ""))}

    case KnowledgeBase.general_write_page(Enum.join(List.wrap(path), "/"), page) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec general_regenerate_home(Conn.t(), map()) :: Conn.t()
  def general_regenerate_home(conn, _params) do
    case KnowledgeBase.general_regenerate_home() do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
```

- [ ] **Step 6: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/controllers/tracker/general_knowledge_base_controller_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base.ex elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/controllers/tracker/general_knowledge_base_controller_test.exs
git commit -m "feat(kb): general knowledge base endpoints and home regeneration"
```

---

## Task 5: Milestone verification

- [ ] **Step 1:** `mix format --check-formatted`
- [ ] **Step 2:** `mix compile --warnings-as-errors`
- [ ] **Step 3:** `mix test test/symphony_elixir/knowledge_base test/symphony_elixir/github/repositories_test.exs test/symphony_elixir_web/controllers/tracker/general_knowledge_base_controller_test.exs` -> all pass
- [ ] **Step 4:** commit any fixes (`chore(kb): format milestone 5`).

---

## Self-Review

**Spec coverage (M5):**

| Spec requirement | Task |
|---|---|
| Personal KB in private `symphony-kb` GitHub repo (user's account) | Task 1 (`Repositories.ensure`), Task 3 (`connect` clone) |
| Regenerable home page linking all project KBs | Task 2 (`HomePage.render`), Task 3 (`regenerate_home`), Task 4 (`POST /kb/home`) |
| Reuse read/write/search/sync machinery under `@user` | Task 3 (Workspace/Writer/Indexer/Search), Task 4 (delegations) |
| `GET /kb` overview, `/kb/pages/*path`, `/kb/search` populated | Task 4 |

**Risks/decisions:**
- All network effects (login, repo create, clone) are injectable; tests run offline against a local bare repo, including the controller test via `:kb_general_deps`.
- Home page is fully generated (overwrite); manual edit preservation deferred.
- `@user` scope cannot collide with real slugs (leading `@`). `repo_slug = "@user~symphony-kb"` keeps search filtering consistent with the global form used in M3.
- Confirmation flags carry fallbacks: `Viewer.resolve_login` arity, `Config.workspace_root`, `LocalTracker.Git.clone/3` signature.

**Placeholder scan:** No TBD/TODO.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-05-general-kb.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.
