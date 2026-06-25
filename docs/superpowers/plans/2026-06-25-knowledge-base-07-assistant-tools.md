# Knowledge Base - Milestone 7: Repository-aware Assistant Tools Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task, or **(B)** inline execution with checkpoints. All Elixir commands run from `elixir/`. Depends on M1-M5 backend merged (read/write/search/sync). Run `mix specs.check` per project convention.

**Goal:** Let the existing Codex-based assistant create and maintain the knowledge base and link tasks to docs, fully aware that a project may span multiple repositories. The assistant can list KB repositories, search/read/create/update pages, link an issue into a page, and trigger a sync - always scoped by `(project, repository)`, asking the user which repository when the choice is ambiguous.

**Architecture:** A new `Assistant.KnowledgeBaseTools` module follows the established tool-family pattern (`tool_specs/0` + `execute/4`, returning `{:ok, %{tool, message, data}}`). It resolves the target repository from an optional `repository` argument or the project's single linked repo, and returns a remediation message (instructing the model to ask) when multiple repos match no argument. Tools delegate to the M1-M5 `KnowledgeBase` context. The family is registered in `ToolExecutor` (added to the tracker tool list, spec assembly, and the `do_execute/4` dispatch) so it flows through the existing Codex `dynamicTools` + `tool_executor` pipeline. It is also exposed to freeform chat via `ProjectBoardTools` (project_slug injected into the schema).

**Tech Stack:** Elixir, `SymphonyElixir.Assistant.ToolExecutor`/`ToolSchema`/`ProjectBoardTools`, `SymphonyElixir.KnowledgeBase` context, `LocalTracker.Context`, Codex app-server tool plumbing (unchanged).

---

## Plan sequence

M1 read -> M2 editing -> M3 search -> M4 git flows -> M5 general KB -> M6 frontend -> **M7 assistant tools (this plan)**. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md` (Section 10 KB assistant, repository-aware).

---

## File structure (M7)

Create:
- `elixir/lib/symphony_elixir/assistant/knowledge_base_tools.ex` - the KB tool family.
- `elixir/test/symphony_elixir/assistant/knowledge_base_tools_test.exs`

Modify:
- `elixir/lib/symphony_elixir/assistant/tool_executor.ex` - alias + register tool names + append specs + add `do_execute/4` dispatch clause.
- `elixir/lib/symphony_elixir/assistant/project_board_tools.ex` - add KB tool names to `@scoped_tools` (freeform chat support).
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` - mention KB tools in the relevant system prompts.
- `elixir/test/symphony_elixir/assistant/tool_executor_test.exs` - assert KB tool registration + codex result shape.

Locked decisions:
- Tools: `kb_list_repositories`, `kb_search_pages`, `kb_read_page`, `kb_create_page`, `kb_update_page`, `kb_link_task`, `kb_sync`.
- `repository` arg accepts the GitHub full name (`acme/web`), the short repo name (`web`), or the URL repo slug (`acme~web`); it is resolved against `Context.list_repositories/1`.
- Ambiguity (no `repository` + multiple linked repos) returns a successful result whose `message` instructs the model to ask the user, with `data.repositories` listing the choices (mirrors `SetupTools` remediation), rather than guessing.
- `kb_create_page` fails if the page already exists; `kb_update_page` fails if it does not - both delegate to `KnowledgeBase.write_page/4`.
- `kb_link_task` appends a `> Related issue: [IDENT](url)` reference block to the page body and re-saves; the issue is looked up via the project's tracker adapter.

---

## Task 1: `Assistant.KnowledgeBaseTools` module

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/knowledge_base_tools.ex`
- Test: `elixir/test/symphony_elixir/assistant/knowledge_base_tools_test.exs`

- [ ] **Step 1: Write the failing test** (reuse the isolated-workspace + real-git-checkout seeding used by the M1/M2 KB tests; create a project `acme` with one repository `acme/web` whose `docs/` is committed)

```elixir
defmodule SymphonyElixir.Assistant.KnowledgeBaseToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.KnowledgeBaseTools

  import SymphonyElixir.TestSupport, only: [migrate_repo: 0, clean_repo: 0]

  setup do
    migrate_repo()
    clean_repo()
    # Seed project "acme" + repository "acme/web" with a committed docs/ tree on a
    # real git checkout under an isolated workspace root (same helper as kb tests).
    {:ok, ctx} = SymphonyElixir.KnowledgeBaseTestFixtures.seed_single_repo_project("acme", "acme/web")
    on_exit(ctx.cleanup)
    :ok
  end

  test "tool_specs declares the kb tools with json schemas" do
    names = KnowledgeBaseTools.tool_specs() |> Enum.map(& &1["name"])
    assert "kb_search_pages" in names
    assert "kb_create_page" in names
    spec = Enum.find(KnowledgeBaseTools.tool_specs(), &(&1["name"] == "kb_search_pages"))
    assert spec["inputSchema"]["required"] == ["query"]
  end

  test "kb_list_repositories returns the project's linked repos" do
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_list_repositories", %{}, [])
    assert result.tool == "kb_list_repositories"
    assert Enum.any?(result.data.repositories, &(&1.github_full_name == "acme/web"))
  end

  test "kb_create_page writes a new page in the resolved repository" do
    args = %{"repository" => "acme/web", "path" => "guides/new.md", "title" => "New", "body" => "# New\n\nhello"}
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_create_page", args, [])
    assert result.data.path == "guides/new.md"

    assert {:ok, page} = KnowledgeBaseTools.execute("acme", "kb_read_page", %{"repository" => "acme/web", "path" => "guides/new.md"}, [])
    assert page.data.body =~ "hello"
  end

  test "kb_create_page on an existing page returns an error" do
    args = %{"repository" => "acme/web", "path" => "index.md", "title" => "X", "body" => "y"}
    assert {:error, :kb_page_exists} = KnowledgeBaseTools.execute("acme", "kb_create_page", args, [])
  end

  test "kb_search_pages finds a saved page by body text" do
    KnowledgeBaseTools.execute("acme", "kb_create_page", %{"repository" => "acme/web", "path" => "z.md", "title" => "Z", "body" => "a unique narwhal phrase"}, [])
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_search_pages", %{"query" => "narwhal"}, [])
    assert Enum.any?(result.data.results, &(&1.path == "z.md"))
  end

  test "omitting repository with multiple repos returns a remediation asking the user" do
    {:ok, _} = SymphonyElixir.KnowledgeBaseTestFixtures.add_repo("acme", "acme/api")
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_read_page", %{"path" => "index.md"}, [])
    assert result.data[:remediation]
    assert result.message =~ "which repository"
  end

  test "missing required arg returns missing_required_field" do
    assert {:error, {:missing_required_field, "query"}} = KnowledgeBaseTools.execute("acme", "kb_search_pages", %{}, [])
  end
end
```

(If a `KnowledgeBaseTestFixtures` helper does not exist yet, create it as a small test support module that seeds a project + repository + committed `docs/` under an isolated workspace root - factor it out of the existing M1/M2 test setup so multiple suites share it. This is a legitimate test-support task within M7.)

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/assistant/knowledge_base_tools_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.Assistant.KnowledgeBaseTools do
  @moduledoc """
  Repository-aware knowledge base tools for the assistant: list repos, search,
  read, create, update pages, link tasks into docs, and trigger sync. Every
  operation is scoped by `(project, repository)`; when the repository is
  ambiguous the tool asks the user instead of guessing.
  """

  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixir.LocalTracker.Context

  @tools ~w(kb_list_repositories kb_search_pages kb_read_page kb_create_page kb_update_page kb_link_task kb_sync)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec("kb_list_repositories", "List the project's knowledge base repositories and whether each has docs.", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }),
      spec("kb_search_pages", "Full-text search knowledge base pages across the project's repositories.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["query"],
        "properties" => %{
          "query" => string_schema("Search text (matches title and body)."),
          "repository" => repository_schema()
        }
      }),
      spec("kb_read_page", "Read a knowledge base page's content.", page_schema(["path"])),
      spec("kb_create_page", "Create a new knowledge base page (fails if it already exists).", page_write_schema()),
      spec("kb_update_page", "Update an existing knowledge base page.", page_write_schema()),
      spec("kb_link_task", "Append a reference to a tracker issue into a knowledge base page.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["path", "identifier"],
        "properties" => %{
          "path" => string_schema("Page path within docs, e.g. architecture/backend.md."),
          "identifier" => string_schema("Issue identifier, e.g. MAC-12."),
          "repository" => repository_schema()
        }
      }),
      spec("kb_sync", "Trigger a knowledge base sync (merge default branch, open/update PR, auto-merge when green).", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{"repository" => repository_schema()}
      })
    ]
  end

  @spec execute(String.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, tool, arguments, opts \\ [])

  def execute(project_slug, "kb_list_repositories", _args, _opts) do
    repos = list_repos(project_slug)
    {:ok, ok("kb_list_repositories", "Found #{length(repos)} repositories.", %{repositories: Enum.map(repos, &repo_view/1)})}
  end

  def execute(project_slug, "kb_search_pages", args, _opts) do
    with {:ok, query} <- required(args, "query") do
      repo_opt = repo_filter(project_slug, args)
      {:ok, results} = KnowledgeBase.search_project(project_slug, query, repo_opt)
      {:ok, ok("kb_search_pages", "Found #{length(results)} matching pages.", %{results: results})}
    end
  end

  def execute(project_slug, "kb_read_page", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, repo} <- resolve_repo(project_slug, args, "kb_read_page") do
      maybe_remediation(repo, fn slug ->
        case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
          {:ok, page} -> {:ok, ok("kb_read_page", "Read #{path}.", page)}
          {:error, reason} -> {:error, reason}
        end
      end)
    end
  end

  def execute(project_slug, "kb_create_page", args, _opts) do
    write_page(project_slug, args, "kb_create_page", :must_not_exist)
  end

  def execute(project_slug, "kb_update_page", args, _opts) do
    write_page(project_slug, args, "kb_update_page", :must_exist)
  end

  def execute(project_slug, "kb_link_task", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, identifier} <- required(args, "identifier"),
         {:ok, repo} <- resolve_repo(project_slug, args, "kb_link_task") do
      maybe_remediation(repo, fn slug -> do_link_task(project_slug, slug, path, identifier) end)
    end
  end

  def execute(project_slug, "kb_sync", args, _opts) do
    with {:ok, repo} <- resolve_repo(project_slug, args, "kb_sync") do
      maybe_remediation(repo, fn slug ->
        _ = KnowledgeBase.request_sync(project_slug, slug)
        {:ok, ok("kb_sync", "Sync requested for #{slug}.", %{repo_slug: slug})}
      end)
    end
  end

  def execute(_project_slug, tool, _args, _opts), do: {:error, {:unsupported_tool, tool}}

  # --- repository resolution -------------------------------------------------

  defp resolve_repo(project_slug, args, _tool) do
    repos = list_repos(project_slug)

    case Map.get(args, "repository") do
      value when is_binary(value) and value != "" ->
        case match_repo(repos, value) do
          nil -> {:error, :kb_repository_not_found}
          repo -> {:ok, {:resolved, repo_slug(repo)}}
        end

      _ ->
        case repos do
          [single] -> {:ok, {:resolved, repo_slug(single)}}
          [] -> {:error, :repo_not_checked_out}
          many -> {:ok, {:ambiguous, many}}
        end
    end
  end

  defp maybe_remediation({:resolved, slug}, fun), do: fun.(slug)

  defp maybe_remediation({:ambiguous, repos}, _fun) do
    {:ok,
     %{
       tool: "kb_repository_choice",
       message: "Multiple repositories are linked. ASK the user which repository to use, then call the tool again with the repository argument.",
       data: %{repositories: Enum.map(repos, &repo_view/1), remediation: "needs_repository"}
     }}
  end

  defp write_page(project_slug, args, tool, existence) do
    with {:ok, path} <- required(args, "path"),
         {:ok, body} <- required(args, "body"),
         {:ok, repo} <- resolve_repo(project_slug, args, tool) do
      maybe_remediation(repo, fn slug ->
        with :ok <- check_existence(project_slug, slug, path, existence),
             page <- build_page(args, body),
             {:ok, result} <- KnowledgeBase.write_page(project_slug, slug, String.split(path, "/"), page) do
          {:ok, ok(tool, "Saved #{path} in #{slug}.", result)}
        end
      end)
    end
  end

  defp check_existence(project_slug, slug, path, :must_not_exist) do
    case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      {:ok, _} -> {:error, :kb_page_exists}
      {:error, :kb_page_not_found} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp check_existence(project_slug, slug, path, :must_exist) do
    case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp build_page(args, body) do
    frontmatter = if title = args["title"], do: %{"title" => title}, else: %{}
    %{frontmatter: frontmatter, body: body}
  end

  defp do_link_task(project_slug, slug, path, identifier) do
    with {:ok, page} <- KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      ref = "\n\n> Related issue: [#{identifier}](#{issue_url(project_slug, identifier)})\n"
      updated = %{frontmatter: page.frontmatter, body: page.body <> ref}

      case KnowledgeBase.write_page(project_slug, slug, String.split(path, "/"), updated) do
        {:ok, result} -> {:ok, ok("kb_link_task", "Linked #{identifier} into #{path}.", result)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp repo_filter(project_slug, args) do
    case Map.get(args, "repository") do
      value when is_binary(value) and value != "" ->
        case match_repo(list_repos(project_slug), value) do
          nil -> []
          repo -> [repo_slug: repo_slug(repo)]
        end

      _ ->
        []
    end
  end

  # --- helpers ---------------------------------------------------------------

  defp list_repos(project_slug), do: Context.list_repositories(project_slug)

  defp match_repo(repos, value) do
    Enum.find(repos, fn repo ->
      value in [repo.github_full_name, repo.name, repo_slug(repo)]
    end)
  end

  defp repo_slug(repo), do: SymphonyElixir.KnowledgeBase.Paths.repo_slug(repo.github_full_name)

  defp repo_view(repo) do
    %{name: repo.name, github_full_name: repo.github_full_name, repo_slug: repo_slug(repo)}
  end

  defp issue_url(project_slug, identifier), do: "/projects/#{project_slug}/board/issues/#{identifier}"

  defp required(args, key) do
    case args |> Map.get(key) |> to_string() |> String.trim() do
      "" -> {:error, {:missing_required_field, key}}
      value -> {:ok, value}
    end
  end

  defp ok(tool, message, data), do: %{tool: tool, message: message, data: data}

  defp spec(name, description, schema), do: %{"name" => name, "description" => description, "inputSchema" => schema}

  defp string_schema(description), do: %{"type" => "string", "description" => description}

  defp repository_schema,
    do: %{"type" => ["string", "null"], "description" => "Repository (owner/name, short name, or slug). Omit to use the only repo; required when several are linked."}

  defp page_schema(required) do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => required,
      "properties" => %{"path" => string_schema("Page path within docs."), "repository" => repository_schema()}
    }
  end

  defp page_write_schema do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["path", "body"],
      "properties" => %{
        "path" => string_schema("Page path within docs, e.g. guides/intro.md."),
        "title" => string_schema("Optional page title (stored as frontmatter)."),
        "body" => string_schema("Markdown body."),
        "repository" => repository_schema()
      }
    }
  end
end
```

Confirm `KnowledgeBase.Paths.repo_slug/1` is the canonical encoder (M1) and that `Context.list_repositories/1` returns structs with `:github_full_name` and `:name`. Adjust `repo_view`/`match_repo` field names if the schema differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/assistant/knowledge_base_tools_test.exs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/knowledge_base_tools.ex elixir/test/symphony_elixir/assistant/knowledge_base_tools_test.exs elixir/test/support
git commit -m "feat(kb): repository-aware knowledge base assistant tools"
```

---

## Task 2: Register the family in `ToolExecutor`

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex`
- Test: append to `elixir/test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 1: Write the failing test (append)**

```elixir
  test "kb tools are advertised and dispatch through the executor" do
    {:ok, ctx} = SymphonyElixir.KnowledgeBaseTestFixtures.seed_single_repo_project("acme", "acme/web")
    on_exit(ctx.cleanup)

    names = ToolExecutor.tool_specs() |> Enum.map(&Map.get(&1, "name"))
    assert "kb_search_pages" in names

    response = ToolExecutor.codex_tool_executor("acme").("kb_list_repositories", %{})
    assert %{"success" => true, "toolResult" => %{"tool" => "kb_list_repositories"}} = response
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/assistant/tool_executor_test.exs`
Expected: FAIL (kb tools not registered).

- [ ] **Step 3: Wire it up**

1. Add alias near the other tool-module aliases:

```elixir
  alias SymphonyElixir.Assistant.KnowledgeBaseTools
```

2. Append KB tool names to the supported set. Add to `@tracker_tools` (which feeds `@supported_tools`):

```elixir
  @tracker_tools ~w(... existing ...) ++ KnowledgeBaseTools.tools()
```

(If `@tracker_tools` is a literal `~w(...)` list, instead introduce `@kb_tools KnowledgeBaseTools.tools()` and include it in `@supported_tools` next to the other delegated tool lists: `@supported_tools @tracker_tools ++ @read_tools ++ @github_tools ++ @kb_tools`.)

3. Append KB specs in `build_tool_specs/0` (end of the list):

```elixir
    ... ++ ReadTools.tool_specs() ++ GitHubTools.tool_specs() ++ KnowledgeBaseTools.tool_specs()
```

4. Add a dispatch clause in `do_execute/4` (place near the other delegated clauses):

```elixir
  defp do_execute(project, tool, arguments, opts) when tool in @kb_tools do
    KnowledgeBaseTools.execute(project.slug, tool, arguments, opts)
  end
```

(Use whatever accessor gives the slug from the loaded `project` struct - confirm `project.slug`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/assistant/tool_executor_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tool_executor.ex elixir/test/symphony_elixir/assistant/tool_executor_test.exs
git commit -m "feat(kb): register knowledge base tools in the executor"
```

---

## Task 3: Freeform chat exposure + prompt mentions

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/project_board_tools.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Test: append to `elixir/test/symphony_elixir/assistant/project_board_tools_test.exs`

- [ ] **Step 1: Add KB tools to freeform `@scoped_tools`**

In `project_board_tools.ex`, add the KB tool names to `@scoped_tools` so freeform chat can call them with an injected `project_slug` (handled by `ToolSchema.with_project_slug/1` + the existing `execute/3` routing back into `ToolExecutor.execute/4`).

```elixir
  @scoped_tools ~w(... existing ...) ++ SymphonyElixir.Assistant.KnowledgeBaseTools.tools()
```

- [ ] **Step 2: Write the failing test (append)**

```elixir
  test "kb tools are scoped with project_slug in freeform chat" do
    spec = ProjectBoardTools.tool_specs() |> Enum.find(&(&1["name"] == "kb_search_pages"))
    assert "project_slug" in spec["inputSchema"]["required"]
  end
```

- [ ] **Step 3: Run test, verify pass**

Run: `mix test test/symphony_elixir/assistant/project_board_tools_test.exs`
Expected: PASS after Step 1.

- [ ] **Step 4: Mention KB tools in prompts**

In `codex_session.ex`, in the prompt-building functions (`build_prompt/4`, `build_freeform_prompt/4`, and the project-explore prompt), add a brief line describing the KB tools and the repository-awareness rule, e.g.:

> "Use the kb_* tools to maintain the knowledge base. A project may span multiple repositories; if the target repository is unclear, ask the user before writing."

Keep it concise; no test required for prompt text (optionally add a `grep`-style assertion that the prompt contains "kb_" if the project tests prompts).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/project_board_tools.ex elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir/assistant/project_board_tools_test.exs
git commit -m "feat(kb): expose kb tools in freeform chat and prompts"
```

---

## Task 4: Codex failure-message formatting (optional polish)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/tool_executor.ex` (`codex_failure_response/1` clauses)
- Test: append to `elixir/test/symphony_elixir/assistant/tool_executor_test.exs`

- [ ] **Step 1: Write the failing test (append)**

```elixir
  test "kb-specific errors are humanized for the model" do
    {:ok, ctx} = SymphonyElixir.KnowledgeBaseTestFixtures.seed_single_repo_project("acme", "acme/web")
    on_exit(ctx.cleanup)

    response = ToolExecutor.codex_tool_executor("acme").("kb_create_page", %{"repository" => "acme/web", "path" => "index.md", "body" => "x"})
    assert %{"success" => false, "contentItems" => [%{"text" => text}]} = response
    assert text =~ "already exists"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/assistant/tool_executor_test.exs`
Expected: FAIL (falls to generic error text).

- [ ] **Step 3: Add `codex_failure_response/1` clauses** (near the other error-humanizing clauses)

```elixir
  defp codex_failure_response(:kb_page_exists),
    do: failure_response(%{error: "That knowledge base page already exists. Use kb_update_page to modify it."})

  defp codex_failure_response(:kb_repository_not_found),
    do: failure_response(%{error: "No linked repository matches that name. Call kb_list_repositories to see the options."})

  defp codex_failure_response(:kb_page_not_found),
    do: failure_response(%{error: "That knowledge base page does not exist."})
```

(Match the exact shape of the existing `failure_response/1` payload used by the module.)

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/assistant/tool_executor_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/tool_executor.ex elixir/test/symphony_elixir/assistant/tool_executor_test.exs
git commit -m "feat(kb): humanize knowledge base tool errors for the assistant"
```

---

## Task 5: Milestone verification

- [ ] **Step 1:** `mix format --check-formatted`
- [ ] **Step 2:** `mix compile --warnings-as-errors`
- [ ] **Step 3:** `mix specs.check` (project convention - all public functions typed)
- [ ] **Step 4:** `mix test test/symphony_elixir/assistant/knowledge_base_tools_test.exs test/symphony_elixir/assistant/tool_executor_test.exs test/symphony_elixir/assistant/project_board_tools_test.exs` -> all pass
- [ ] **Step 5:** commit any fixes (`chore(kb): format milestone 7`).

---

## Self-Review

**Spec coverage (M7):**

| Spec requirement | Task |
|---|---|
| Section 10 assistant focused on KB creation/maintenance | Task 1 (`kb_create_page`, `kb_update_page`, `kb_search_pages`, `kb_read_page`) |
| Section 10 also manages the project, links tasks to docs | Task 1 (`kb_link_task`, `kb_sync`) |
| Section 10 repository-aware (multi-repo understanding) | Task 1 (`resolve_repo` + ambiguity remediation, `kb_list_repositories`) |
| Integrated in the existing assistant tool pipeline | Task 2 (ToolExecutor registration), Task 3 (freeform + prompts) |
| Clear errors guide the model | Task 4 (humanized failures) |

**Risks/decisions:**
- The repository-awareness contract is the core of M7: omitting `repository` with multiple repos returns a remediation result instructing the model to ask, never a guess (mirrors `SetupTools`).
- Tool results conform to the executor's `{:ok, %{tool, message, data}}` contract so the Codex wrapper produces the expected `success`/`toolResult` shape (asserted in Task 2).
- A shared `KnowledgeBaseTestFixtures` is introduced to seed a real git checkout for tests, factored from earlier KB suites; flagged as a small test-support task.
- Confirmation flags (exact `@tracker_tools`/`@supported_tools` composition, `project.slug` accessor, `Context.list_repositories` field names, `failure_response/1` shape) carry concrete fallbacks.

**Placeholder scan:** No TBD/TODO.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-07-assistant-tools.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.

---

## Knowledge Base roadmap - all plans written

| Milestone | Plan file |
|---|---|
| M1 Backend read foundation | `2026-06-25-knowledge-base-01-backend-read-foundation.md` |
| M2 Editing + auto-commit + assets | `2026-06-25-knowledge-base-02-editing-autocommit.md` |
| M3 Full-text search (FTS5) | `2026-06-25-knowledge-base-03-fulltext-search.md` |
| M4 Git background flows (sync, PR, auto-merge) | `2026-06-25-knowledge-base-04-git-flows.md` |
| M5 General user KB (`symphony-kb`) + home generator | `2026-06-25-knowledge-base-05-general-kb.md` |
| M6 Frontend KB UI (Tiptap) | `2026-06-25-knowledge-base-06-frontend.md` |
| M7 Repository-aware assistant tools | `2026-06-25-knowledge-base-07-assistant-tools.md` |
