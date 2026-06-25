# Knowledge Base - Milestone 2: Editing + Auto-commit + Assets Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent per task with review between tasks, or **(B)** inline execution with checkpoints. All Elixir commands run from `elixir/`. Test runner `mix test`; formatter `mix format`. Depends on M1 (read foundation) being merged.

**Goal:** Let users create/update/move/delete KB Markdown pages and upload assets, persisting each change as an auto-commit on a dedicated `symphony-docs` git worktree per repository, with frontmatter serialized deterministically and relative asset links inserted.

**Architecture:** Introduce `KnowledgeBase.Git` (thin git CLI wrapper with an injectable runner, mirroring `RunContract.git/2`) and `KnowledgeBase.Workspace` (resolves/creates a per-repo worktree at `<checkout>/.worktrees/symphony-docs`). All KB file access (reads from M1 and writes here) routes through `Workspace.ensure/2` so reads and writes are consistent on `symphony-docs`. Writes go through `KnowledgeBase.Writer` (serialize frontmatter + body, scoped `git add`, commit with a Symphony identity, best-effort push). Assets reuse the validation constants of the assistant `AttachmentStore` but are written into the repo's `docs/assets/` with content-hash filenames. The controller adds `PUT page`, `POST move`, `DELETE page`, `POST assets`.

**Tech Stack:** Elixir/Phoenix, `git` CLI via `System.cmd/3`, `ymlr` (YAML encode) + `yaml_elixir` (decode), `jason`, `Plug.Upload`.

---

## Plan sequence

M1 read foundation (done) -> **M2 editing + auto-commit (this plan)** -> M3 full-text search -> M4 git background flows -> M5 general KB -> M6 frontend -> M7 assistant tools. Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`.

---

## File structure (M2)

Create:
- `elixir/lib/symphony_elixir/knowledge_base/git.ex` - git CLI wrapper (injectable runner) + worktree ensure, branch, add, commit, push, status.
- `elixir/lib/symphony_elixir/knowledge_base/workspace.ex` - resolve/create per-repo `symphony-docs` worktree; expose docs root.
- `elixir/lib/symphony_elixir/knowledge_base/frontmatter.ex` - serialize/merge frontmatter + body to a Markdown string.
- `elixir/lib/symphony_elixir/knowledge_base/writer.ex` - write/move/delete a page and commit; upload asset and commit.
- `elixir/lib/symphony_elixir/knowledge_base/assets.ex` - validate + content-hash name + relative link building.
- `elixir/test/symphony_elixir/knowledge_base/git_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/workspace_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/frontmatter_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/writer_test.exs`
- `elixir/test/symphony_elixir/knowledge_base/assets_test.exs`
- `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs`

Modify:
- `elixir/lib/symphony_elixir/knowledge_base/paths.ex` - add `docs_root_in/1` (docs root under an arbitrary base dir) and reuse in `Workspace`.
- `elixir/lib/symphony_elixir/knowledge_base.ex` - route reads through `Workspace.ensure/2`; add `write_page/4`, `move_page/4`, `delete_page/3`, `store_asset/4`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex` - add `save_page`, `move_page`, `delete_page`, `upload_asset` actions.
- `elixir/lib/symphony_elixir_web/router.ex` - add `PUT/POST/DELETE` routes.
- `elixir/lib/symphony_elixir_web/tracker_errors.ex` - add `:kb_commit_failed`, `:kb_git_dirty`, `:kb_unsupported_asset`, `:kb_asset_too_large`.
- `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex` - add `kb_event/3`.

Locked decisions:
- Docs branch constant `@docs_branch "symphony-docs"` (per-repo override deferred to a future schema column).
- Commit identity: `System.get_env("SYMPHONY_KB_GIT_NAME") || "Symphony"` / `SYMPHONY_KB_GIT_EMAIL || "symphony-kb@localhost"`, applied via `git -c user.name=... -c user.email=...`.
- Push is best-effort: a failed push does NOT fail the write (the commit is local; M4 reconciles). Push failure is reported in the response as `pushed: false`.
- Assets stored at `docs/assets/<sha256>.<ext>`; editor link is relative from the page (computed via `Path.relative_to/2`).

---

## Task 1: `KnowledgeBase.Git`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/git.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/git_test.exs`

- [ ] **Step 1: Write the failing test** (uses real temp git repos; no network)

```elixir
defmodule SymphonyElixir.KnowledgeBase.GitTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Git

  setup do
    base = Path.join(System.tmp_dir!(), "kb-git-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    sh(checkout, ["init", "-q", "-b", "main"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"])
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, checkout: checkout, base: base}
  end

  test "ensure_worktree creates a worktree on a new branch and is idempotent", %{checkout: checkout} do
    assert {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    assert File.dir?(wt)
    assert {:ok, "symphony-docs"} = Git.current_branch(wt)
    assert {:ok, ^wt} = Git.ensure_worktree(checkout, "symphony-docs")
  end

  test "add + commit persist a file on the worktree branch", %{checkout: checkout} do
    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.mkdir_p!(Path.join(wt, "docs"))
    File.write!(Path.join(wt, "docs/x.md"), "# x\n")

    assert :ok = Git.add(wt, ["docs/x.md"])
    assert {:ok, sha} = Git.commit(wt, "docs(kb): add x", name: "Bot", email: "bot@s")
    assert is_binary(sha) and byte_size(sha) >= 7
    assert {:ok, ""} = Git.status_porcelain(wt)
  end

  test "push sends the branch to a bare origin", %{checkout: checkout, base: base} do
    origin = Path.join(base, "origin.git")
    sh(File.cwd!(), ["init", "--bare", "-q", origin])
    sh(checkout, ["remote", "add", "origin", origin])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.write!(Path.join(wt, "f.txt"), "hi")
    :ok = Git.add(wt, ["f.txt"])
    {:ok, _} = Git.commit(wt, "msg", name: "B", email: "b@s")

    assert :ok = Git.push(wt, "symphony-docs")
    assert {output, 0} = System.cmd("git", ["ls-remote", "--heads", origin, "symphony-docs"], stderr_to_stdout: true)
    assert output =~ "symphony-docs"
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/git_test.exs`
Expected: FAIL with module/function undefined.

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Git do
  @moduledoc """
  Thin `git` CLI wrapper for knowledge base writes, mirroring the codebase's
  `System.cmd("git", args, cd: path, stderr_to_stdout: true)` convention. The
  command runner is injectable for tests via the `:runner` option.
  """

  @type runner :: (String.t(), [String.t()], keyword() -> {Collectable.t(), non_neg_integer()})

  @spec run(Path.t(), [String.t()], keyword()) :: {:ok, String.t()} | {:error, {non_neg_integer(), String.t()}}
  def run(dir, args, opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    case runner.("git", args, cd: dir, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, status} -> {:error, {status, String.trim(to_string(output))}}
    end
  end

  @spec current_branch(Path.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def current_branch(dir, opts \\ []), do: run(dir, ["branch", "--show-current"], opts)

  @spec status_porcelain(Path.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def status_porcelain(dir, opts \\ []), do: run(dir, ["status", "--porcelain"], opts)

  @spec ensure_worktree(Path.t(), String.t(), keyword()) :: {:ok, Path.t()} | {:error, term()}
  def ensure_worktree(checkout, branch, opts \\ []) do
    path = Path.join([checkout, ".worktrees", branch])

    if File.dir?(path) do
      {:ok, path}
    else
      File.mkdir_p!(Path.dirname(path))
      args = worktree_add_args(checkout, branch, path, opts)

      case run(checkout, args, opts) do
        {:ok, _} -> {:ok, path}
        {:error, reason} -> {:error, {:worktree_failed, reason}}
      end
    end
  end

  @spec add(Path.t(), [String.t()], keyword()) :: :ok | {:error, term()}
  def add(dir, paths, opts \\ []) when is_list(paths) do
    case run(dir, ["add", "--" | paths], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  @spec commit(Path.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def commit(dir, message, opts \\ []) do
    name = Keyword.get(opts, :name, "Symphony")
    email = Keyword.get(opts, :email, "symphony-kb@localhost")
    args = ["-c", "user.name=#{name}", "-c", "user.email=#{email}", "commit", "-m", message]

    with {:ok, _} <- run(dir, args, opts) do
      run(dir, ["rev-parse", "HEAD"], opts)
    end
  end

  @spec push(Path.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def push(dir, branch, opts \\ []) do
    case run(dir, ["push", "-u", "origin", branch], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  @spec fetch(Path.t(), keyword()) :: :ok | {:error, term()}
  def fetch(dir, opts \\ []) do
    case run(dir, ["fetch", "origin"], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  defp worktree_add_args(checkout, branch, path, opts) do
    if branch_exists?(checkout, branch, opts) do
      ["worktree", "add", path, branch]
    else
      ["worktree", "add", "-b", branch, path]
    end
  end

  defp branch_exists?(checkout, branch, opts) do
    match?({:ok, _}, run(checkout, ["rev-parse", "--verify", "--quiet", "refs/heads/#{branch}"], opts))
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/git_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/git.ex elixir/test/symphony_elixir/knowledge_base/git_test.exs
git commit -m "feat(kb): add git CLI wrapper with worktree, commit, and push"
```

---

## Task 2: `KnowledgeBase.Workspace` + `Paths.docs_root_in/1`

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/workspace.ex`
- Modify: `elixir/lib/symphony_elixir/knowledge_base/paths.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/workspace_test.exs`

- [ ] **Step 1: Add `docs_root_in/1` to `Paths`**

In `paths.ex` add:

```elixir
  @spec docs_root_in(Path.t()) :: Path.t()
  def docs_root_in(base) when is_binary(base), do: Path.join(base, @docs_dir)
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.WorkspaceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Workspace

  setup do
    base = Path.join(System.tmp_dir!(), "kb-ws-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    sh(checkout, ["init", "-q", "-b", "main"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"])
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, checkout: checkout}
  end

  test "ensure returns a docs working directory on the symphony-docs branch", %{checkout: checkout} do
    assert {:ok, %{worktree: wt, docs_root: docs}} = Workspace.ensure(checkout)
    assert File.dir?(wt)
    assert docs == Path.join(wt, "docs")
    assert {:ok, "symphony-docs"} = SymphonyElixir.KnowledgeBase.Git.current_branch(wt)
  end

  test "ensure errors when the checkout is not a git repo" do
    missing = Path.join(System.tmp_dir!(), "kb-not-a-repo-#{System.unique_integer([:positive])}")
    File.mkdir_p!(missing)
    assert {:error, _} = Workspace.ensure(missing)
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/workspace_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Workspace do
  @moduledoc """
  Resolves the knowledge base working directory for a repository checkout.

  KB edits live on a dedicated `symphony-docs` branch, materialized as a git
  worktree at `<checkout>/.worktrees/symphony-docs`. Both reads and writes use
  this directory so the UI always sees the same content it commits.
  """

  alias SymphonyElixir.KnowledgeBase.{Git, Paths}

  @docs_branch "symphony-docs"

  @type t :: %{worktree: Path.t(), docs_root: Path.t(), branch: String.t()}

  @spec docs_branch() :: String.t()
  def docs_branch, do: @docs_branch

  @spec ensure(Path.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def ensure(checkout, opts \\ []) when is_binary(checkout) do
    with {:ok, worktree} <- Git.ensure_worktree(checkout, @docs_branch, opts) do
      {:ok, %{worktree: worktree, docs_root: Paths.docs_root_in(worktree), branch: @docs_branch}}
    end
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/workspace_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/workspace.ex elixir/lib/symphony_elixir/knowledge_base/paths.ex elixir/test/symphony_elixir/knowledge_base/workspace_test.exs
git commit -m "feat(kb): resolve per-repo symphony-docs worktree"
```

---

## Task 3: Route M1 reads through `Workspace.ensure/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/knowledge_base.ex`
- Modify: `elixir/test/symphony_elixir/knowledge_base_test.exs` (set up a real git checkout so the worktree can be created)

This makes reads consistent with writes. `repo_checkout/2` (main clone) becomes the source for the worktree; the docs tree/page reads come from the worktree's `docs/`.

- [ ] **Step 1: Update the read context**

In `knowledge_base.ex`, replace the docs-root resolution in `repo_tree/2` and `read_page/3` to use the worktree. Add a private helper:

```elixir
  alias SymphonyElixir.KnowledgeBase.Workspace

  defp ensure_docs_root(project_slug, repo) do
    checkout = Paths.repo_checkout(project_slug, repo.workspace_path)

    if File.dir?(checkout) do
      with {:ok, %{docs_root: docs_root}} <- Workspace.ensure(checkout) do
        {:ok, docs_root}
      end
    else
      {:error, :repo_not_checked_out}
    end
  end
```

Then in `repo_tree/2`:

```elixir
  def repo_tree(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo) do
      {:ok, %{repository: repo_summary(repo), docs_present: File.dir?(docs_root), tree: Tree.build(docs_root)}}
    end
  end
```

And in `read_page/3` resolve via `docs_root` instead of `Paths.resolve_page` on the main checkout:

```elixir
  def read_page(project_slug, repo_slug, rel) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo),
         {:ok, abs} <- Paths.resolve_page_in(docs_root, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, content} <- read_file(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(rel)) do
      {:ok, page_payload(repo, rel, page, content)}
    end
  end
```

Add `Paths.resolve_page_in/2` (validate + resolve under an explicit docs root), refactoring `resolve_page/3` to delegate:

```elixir
  @spec resolve_page_in(Path.t(), [String.t()] | String.t()) :: {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_page_in(docs_root, segments) do
    with {:ok, rel} <- safe_relative_path(segments) do
      root = Path.expand(docs_root)
      full = root |> Path.join(rel) |> Path.expand()
      if full == root or String.starts_with?(full, root <> "/"), do: {:ok, full}, else: {:error, :kb_invalid_path}
    end
  end

  def resolve_page(project_slug, workspace_path, segments),
    do: resolve_page_in(docs_root(project_slug, workspace_path), segments)
```

Add a `:repo_not_checked_out` clause to `TrackerErrors` (404) in this task as well.

- [ ] **Step 2: Update the read test setup to use a real git repo**

In `knowledge_base_test.exs`, change `configure_isolated_workspace_root` callers so the repo checkout is a real git repo with an initial commit and the docs files committed on `main` (so the `symphony-docs` worktree inherits them). Replace the docs-writing block with:

```elixir
    checkout = Path.join([root, "acme", "web"])
    File.mkdir_p!(Path.join(checkout, "docs/architecture"))
    File.write!(Path.join(checkout, "docs/index.md"), "---\ntitle: Home\n---\n# Home\n")
    File.write!(Path.join(checkout, "docs/architecture/backend.md"), "---\ntitle: Backend\n---\n# B\n\nbody\n")
    File.write!(Path.join(checkout, "docs/broken.md"), "---\n- not\n- a map\n---\nx")
    git(checkout, ["init", "-q", "-b", "main"])
    git(checkout, ["add", "-A"])
    git(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed docs"])
```

and add `defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs test/symphony_elixir/knowledge_base/paths_test.exs`
Expected: PASS. (Paths tests still pass: `resolve_page/3` delegates and keeps the same behavior.)

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base.ex elixir/lib/symphony_elixir/knowledge_base/paths.ex elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir/knowledge_base_test.exs
git commit -m "refactor(kb): read pages from the symphony-docs worktree"
```

---

## Task 4: `KnowledgeBase.Frontmatter` (serialize)

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/frontmatter.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/frontmatter_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.FrontmatterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{Frontmatter, MarkdownPage}

  test "serialize emits a YAML frontmatter block followed by the body" do
    out = Frontmatter.serialize(%{"title" => "Hello", "order" => 3}, "# Hello\n\nbody\n")
    assert String.starts_with?(out, "---\n")
    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.frontmatter["title"] == "Hello"
    assert page.frontmatter["order"] == 3
    assert page.body == "# Hello\n\nbody\n"
  end

  test "serialize without frontmatter returns the body unchanged" do
    assert Frontmatter.serialize(%{}, "plain body\n") == "plain body\n"
  end

  test "merge keeps existing keys and overrides provided ones" do
    assert Frontmatter.merge(%{"title" => "Old", "order" => 1}, %{"title" => "New"}) ==
             %{"title" => "New", "order" => 1}
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/frontmatter_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Frontmatter do
  @moduledoc "Serializes knowledge base frontmatter + body into a Markdown document."

  @spec serialize(map(), String.t()) :: String.t()
  def serialize(frontmatter, body) when is_map(frontmatter) and is_binary(body) do
    if map_size(frontmatter) == 0 do
      body
    else
      {:ok, yaml} = Ymlr.document(frontmatter)
      yaml = yaml |> String.trim_leading() |> strip_leading_doc_marker()
      "---\n" <> String.trim_trailing(yaml) <> "\n---\n" <> body
    end
  end

  @spec merge(map(), map()) :: map()
  def merge(existing, updates) when is_map(existing) and is_map(updates), do: Map.merge(existing, updates)

  # Ymlr.document/1 prefixes a YAML document with "---\n"; strip it so we control the fences.
  defp strip_leading_doc_marker("---\n" <> rest), do: rest
  defp strip_leading_doc_marker(other), do: other
end
```

Note: `ymlr` is already a dependency (`~> 5.0`). Confirm the function name with `mix run -e "IO.inspect(Ymlr.document(%{\"a\" => 1}))"`; if your `ymlr` version exposes `Ymlr.document!/1` instead, switch to that single-arg form. Both return a string starting with `---`.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/frontmatter_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/frontmatter.ex elixir/test/symphony_elixir/knowledge_base/frontmatter_test.exs
git commit -m "feat(kb): serialize frontmatter and body to markdown"
```

---

## Task 5: `KnowledgeBase.Assets` (validate + content-hash + link)

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/assets.ex`
- Test: `elixir/test/symphony_elixir/knowledge_base/assets_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.AssetsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Assets

  test "validate accepts allowed image extensions within the size limit" do
    assert Assets.validate("logo.png", 1_000) == {:ok, ".png"}
    assert Assets.validate("photo.JPG", 1_000) == {:ok, ".jpg"}
  end

  test "validate rejects unsupported types and oversized files" do
    assert Assets.validate("notes.exe", 10) == {:error, :kb_unsupported_asset}
    assert Assets.validate("logo.png", 5 * 1024 * 1024) == {:error, :kb_asset_too_large}
  end

  test "content_name produces a deterministic sha256 filename" do
    name = Assets.content_name(<<1, 2, 3>>, ".png")
    assert name == Assets.content_name(<<1, 2, 3>>, ".png")
    assert String.ends_with?(name, ".png")
    assert byte_size(name) == 64 + 4
  end

  test "relative_link builds a path from the page to the asset" do
    assert Assets.relative_link("architecture/backend.md", "assets/ab.png") == "../assets/ab.png"
    assert Assets.relative_link("index.md", "assets/ab.png") == "assets/ab.png"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/assets_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 3: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Assets do
  @moduledoc """
  Validation and naming for knowledge base assets stored under `docs/assets/`.
  Limits mirror the assistant `AttachmentStore` image constraints.
  """

  @max_bytes 4 * 1024 * 1024
  @allowed_extensions ~w(.png .jpg .jpeg .gif .webp)

  @spec validate(String.t(), non_neg_integer()) ::
          {:ok, String.t()} | {:error, :kb_unsupported_asset | :kb_asset_too_large}
  def validate(filename, size_bytes) when is_binary(filename) and is_integer(size_bytes) do
    ext = filename |> Path.extname() |> String.downcase() |> normalize_ext()

    cond do
      ext not in @allowed_extensions -> {:error, :kb_unsupported_asset}
      size_bytes > @max_bytes -> {:error, :kb_asset_too_large}
      true -> {:ok, ext}
    end
  end

  @spec content_name(binary(), String.t()) :: String.t()
  def content_name(bytes, ext) when is_binary(bytes) and is_binary(ext) do
    digest = :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
    digest <> ext
  end

  @spec relative_link(String.t(), String.t()) :: String.t()
  def relative_link(page_rel_path, asset_rel_path) do
    page_dir = Path.dirname(page_rel_path)
    if page_dir in [".", ""], do: asset_rel_path, else: Path.relative_to(asset_rel_path, page_dir, force: true)
  end

  defp normalize_ext(".jpeg"), do: ".jpg"
  defp normalize_ext(ext), do: ext
end
```

Note: `Path.relative_to/3` with `force: true` is available in recent Elixir. If unavailable, compute the prefix of `../` from the page depth: `page_rel_path |> Path.dirname() |> Path.split() |> length()` and prepend that many `../` to `asset_rel_path`. Verify with the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/assets_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/assets.ex elixir/test/symphony_elixir/knowledge_base/assets_test.exs
git commit -m "feat(kb): validate and name knowledge base assets"
```

---

## Task 6: `KnowledgeBase.Writer` + context write functions

**Files:**
- Create: `elixir/lib/symphony_elixir/knowledge_base/writer.ex`
- Modify: `elixir/lib/symphony_elixir/knowledge_base.ex` (add `write_page/4`, `move_page/4`, `delete_page/3`, `store_asset/4`)
- Modify: `elixir/lib/symphony_elixir/local_tracker/broadcaster.ex` (add `kb_event/3`)
- Test: `elixir/test/symphony_elixir/knowledge_base/writer_test.exs`

- [ ] **Step 1: Add `kb_event/3` to Broadcaster**

```elixir
  @spec kb_event(String.t(), String.t(), map()) :: :ok
  def kb_event(project_slug, event_name, payload)
      when is_binary(project_slug) and is_binary(event_name) and is_map(payload) do
    broadcast(project_slug, event_name, payload)
  end
```

- [ ] **Step 2: Write the failing test**

```elixir
defmodule SymphonyElixir.KnowledgeBase.WriterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{Workspace, Writer}

  setup do
    base = Path.join(System.tmp_dir!(), "kb-writer-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    sh(checkout, ["init", "-q", "-b", "main"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"])
    {:ok, ws} = Workspace.ensure(checkout)
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, ws: ws}
  end

  test "write_page creates a file, commits it, and is readable", %{ws: ws} do
    assert {:ok, result} =
             Writer.write_page(ws, ["guide.md"], %{frontmatter: %{"title" => "Guide"}, body: "# Guide\n"})

    assert result.path == "guide.md"
    assert is_binary(result.commit)
    assert File.read!(Path.join(ws.docs_root, "guide.md")) =~ "title: Guide"
    assert {:ok, ""} = SymphonyElixir.KnowledgeBase.Git.status_porcelain(ws.worktree)
  end

  test "move_page renames within docs and commits", %{ws: ws} do
    {:ok, _} = Writer.write_page(ws, ["a.md"], %{frontmatter: %{}, body: "x"})
    assert {:ok, result} = Writer.move_page(ws, ["a.md"], ["b", "c.md"])
    assert result.path == "b/c.md"
    refute File.exists?(Path.join(ws.docs_root, "a.md"))
    assert File.exists?(Path.join(ws.docs_root, "b/c.md"))
  end

  test "delete_page removes the file and commits", %{ws: ws} do
    {:ok, _} = Writer.write_page(ws, ["a.md"], %{frontmatter: %{}, body: "x"})
    assert {:ok, _} = Writer.delete_page(ws, ["a.md"])
    refute File.exists?(Path.join(ws.docs_root, "a.md"))
  end

  test "store_asset writes a content-hashed file under assets and returns a relative link", %{ws: ws} do
    assert {:ok, result} = Writer.store_asset(ws, "diagram.png", <<137, 80, 78, 71>>, page_path: "architecture/x.md")
    assert String.starts_with?(result.asset_path, "assets/")
    assert result.markdown_link == "../" <> result.asset_path
    assert File.exists?(Path.join(ws.docs_root, result.asset_path))
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir/knowledge_base/writer_test.exs`
Expected: FAIL (module undefined).

- [ ] **Step 4: Write minimal implementation**

```elixir
defmodule SymphonyElixir.KnowledgeBase.Writer do
  @moduledoc "Writes knowledge base pages/assets into a worktree and auto-commits them."

  alias SymphonyElixir.KnowledgeBase.{Assets, Frontmatter, Git, Paths}

  @type ws :: %{worktree: Path.t(), docs_root: Path.t(), branch: String.t()}

  @spec write_page(ws(), [String.t()] | String.t(), %{frontmatter: map(), body: String.t()}, keyword()) ::
          {:ok, map()} | {:error, term()}
  def write_page(ws, rel, %{frontmatter: fm, body: body}, opts \\ []) do
    with {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, rel),
         {:ok, page_rel} <- Paths.safe_relative_path(rel),
         :ok <- File.mkdir_p(Path.dirname(abs)),
         :ok <- File.write(abs, Frontmatter.serialize(fm, body)),
         {:ok, commit} <- stage_and_commit(ws, ["docs/#{page_rel}"], commit_message(opts, "update #{page_rel}"), opts) do
      {:ok, %{path: page_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec move_page(ws(), [String.t()] | String.t(), [String.t()] | String.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def move_page(ws, from, to, opts \\ []) do
    with {:ok, from_abs} <- Paths.resolve_page_in(ws.docs_root, from),
         {:ok, to_abs} <- Paths.resolve_page_in(ws.docs_root, to),
         {:ok, from_rel} <- Paths.safe_relative_path(from),
         {:ok, to_rel} <- Paths.safe_relative_path(to),
         :ok <- ensure_exists(from_abs),
         :ok <- File.mkdir_p(Path.dirname(to_abs)),
         :ok <- File.rename(from_abs, to_abs),
         {:ok, commit} <-
           stage_and_commit(ws, ["docs/#{from_rel}", "docs/#{to_rel}"], commit_message(opts, "move #{from_rel} -> #{to_rel}"), opts) do
      {:ok, %{path: to_rel, from: from_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec delete_page(ws(), [String.t()] | String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def delete_page(ws, rel, opts \\ []) do
    with {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, rel),
         {:ok, page_rel} <- Paths.safe_relative_path(rel),
         :ok <- ensure_exists(abs),
         :ok <- File.rm(abs),
         {:ok, commit} <- stage_and_commit(ws, ["docs/#{page_rel}"], commit_message(opts, "delete #{page_rel}"), opts) do
      {:ok, %{path: page_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec store_asset(ws(), String.t(), binary(), keyword()) :: {:ok, map()} | {:error, term()}
  def store_asset(ws, filename, bytes, opts \\ []) do
    with {:ok, ext} <- Assets.validate(filename, byte_size(bytes)) do
      name = Assets.content_name(bytes, ext)
      asset_rel = "assets/#{name}"
      abs = Path.join(ws.docs_root, asset_rel)
      :ok = File.mkdir_p(Path.dirname(abs))
      :ok = File.write(abs, bytes)

      case stage_and_commit(ws, ["docs/#{asset_rel}"], commit_message(opts, "add asset #{name}"), opts) do
        {:ok, commit} ->
          link = if page = opts[:page_path], do: Assets.relative_link(page, asset_rel), else: asset_rel
          {:ok, %{asset_path: asset_rel, markdown_link: link, commit: commit, pushed: maybe_push(ws, opts)}}

        error ->
          error
      end
    end
  end

  defp stage_and_commit(ws, paths, message, opts) do
    git_opts = Keyword.take(opts, [:runner, :name, :email])

    with :ok <- Git.add(ws.worktree, paths, git_opts) do
      case Git.commit(ws.worktree, message, git_opts) do
        {:ok, sha} -> {:ok, sha}
        {:error, reason} -> {:error, {:kb_commit_failed, reason}}
      end
    end
  end

  defp maybe_push(ws, opts) do
    if Keyword.get(opts, :push, false) do
      Git.push(ws.worktree, ws.branch, Keyword.take(opts, [:runner])) == :ok
    else
      false
    end
  end

  defp ensure_exists(abs), do: if(File.regular?(abs), do: :ok, else: {:error, :kb_page_not_found})
  defp commit_message(opts, default), do: Keyword.get(opts, :message, "docs(kb): #{default}")
end
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir/knowledge_base/writer_test.exs`
Expected: PASS (4 tests). (Tests omit `push: true`, so no network is touched; `pushed` defaults to `false`.)

- [ ] **Step 6: Add context write functions**

In `knowledge_base.ex`, add functions that resolve the workspace then delegate to `Writer`, broadcasting a `kb_event`:

```elixir
  alias SymphonyElixir.KnowledgeBase.Writer
  alias SymphonyElixir.LocalTracker.Broadcaster

  @spec write_page(String.t(), String.t(), [String.t()] | String.t(), %{frontmatter: map(), body: String.t()}) ::
          {:ok, map()} | {:error, error()}
  def write_page(project_slug, repo_slug, rel, page) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.write_page(ws, rel, page, push: true) do
      Broadcaster.kb_event(project_slug, "kb_page_saved", %{repo_slug: repo_slug, path: result.path})
      {:ok, result}
    end
  end

  @spec move_page(String.t(), String.t(), [String.t()] | String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def move_page(project_slug, repo_slug, from, to) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.move_page(ws, from, to, push: true) do
      Broadcaster.kb_event(project_slug, "kb_page_moved", %{repo_slug: repo_slug, from: result.from, path: result.path})
      {:ok, result}
    end
  end

  @spec delete_page(String.t(), String.t(), [String.t()] | String.t()) :: {:ok, map()} | {:error, error()}
  def delete_page(project_slug, repo_slug, rel) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.delete_page(ws, rel, push: true) do
      Broadcaster.kb_event(project_slug, "kb_page_deleted", %{repo_slug: repo_slug, path: result.path})
      {:ok, result}
    end
  end

  @spec store_asset(String.t(), String.t(), String.t(), binary(), keyword()) :: {:ok, map()} | {:error, error()}
  def store_asset(project_slug, repo_slug, filename, bytes, opts \\ []) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      Writer.store_asset(ws, filename, bytes, Keyword.put(opts, :push, true))
    end
  end

  defp ensure_workspace(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug) do
      checkout = Paths.repo_checkout(project_slug, repo.workspace_path)
      if File.dir?(checkout), do: Workspace.ensure(checkout), else: {:error, :repo_not_checked_out}
    end
  end
```

Add `:kb_commit_failed`, `:kb_git_dirty`, `:kb_unsupported_asset`, `:kb_asset_too_large`, `:repo_not_checked_out` to the `error` typespec and to `TrackerErrors` (next step).

- [ ] **Step 7: Run the context test to confirm no regressions**

Run: `mix test test/symphony_elixir/knowledge_base_test.exs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/knowledge_base/writer.ex elixir/lib/symphony_elixir/knowledge_base.ex elixir/lib/symphony_elixir/local_tracker/broadcaster.ex elixir/test/symphony_elixir/knowledge_base/writer_test.exs
git commit -m "feat(kb): write/move/delete pages and store assets with auto-commit"
```

---

## Task 7: TrackerErrors clauses for write/asset failures

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_errors.ex`
- Test: append to `elixir/test/symphony_elixir_web/tracker_errors_test.exs`

- [ ] **Step 1: Write the failing test (append)**

```elixir
  test "maps kb write/asset errors" do
    assert TrackerErrors.render(build_conn(), :repo_not_checked_out).status == 404
    assert TrackerErrors.render(build_conn(), :kb_unsupported_asset).status == 422
    assert TrackerErrors.render(build_conn(), :kb_asset_too_large).status == 413
    assert TrackerErrors.render(build_conn(), {:kb_commit_failed, "boom"}).status == 500
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: FAIL (atoms fall to catch-all with wrong statuses).

- [ ] **Step 3: Write minimal implementation** (insert before the binary/`_reason` catch-all)

```elixir
  def render(conn, :repo_not_checked_out),
    do: not_found(conn, "repo_not_checked_out", dgettext("errors", "Repository checkout is not available yet"))

  def render(conn, :kb_unsupported_asset),
    do: error(conn, 422, "kb_unsupported_asset", dgettext("errors", "Only PNG, JPEG, GIF, and WebP assets are supported."))

  def render(conn, :kb_asset_too_large),
    do: error(conn, 413, "kb_asset_too_large", dgettext("errors", "Assets must be 4 MB or smaller."))

  def render(conn, :kb_git_dirty),
    do: error(conn, 409, "kb_git_dirty", dgettext("errors", "The knowledge base working tree has unrelated changes."))

  def render(conn, {:kb_commit_failed, _reason}),
    do: error(conn, 500, "kb_commit_failed", dgettext("errors", "Failed to commit the knowledge base change."))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/tracker_errors_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/tracker_errors.ex elixir/test/symphony_elixir_web/tracker_errors_test.exs
git commit -m "feat(kb): add tracker errors for kb writes and assets"
```

---

## Task 8: Controller write actions + routes

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs`

- [ ] **Step 1: Add routes** (inside the `:tracker_api` scope, after the M1 KB GET routes)

```elixir
    put("/projects/:project_slug/kb/repos/:repo/pages/*path", KnowledgeBaseController, :save_page)
    delete("/projects/:project_slug/kb/repos/:repo/pages/*path", KnowledgeBaseController, :delete_page)
    post("/projects/:project_slug/kb/repos/:repo/move", KnowledgeBaseController, :move_page)
    post("/projects/:project_slug/kb/repos/:repo/assets", KnowledgeBaseController, :upload_asset)
```

- [ ] **Step 2: Write the failing test** (uses a real git checkout, like the M1 controller test setup; reuse the same `configure_isolated_workspace_root` + a real `git init` of the `acme/web` checkout, committed on `main`). Then:

```elixir
  test "PUT creates a page and returns the commit", %{} do
    body = %{"frontmatter" => %{"title" => "New"}, "body" => "# New\n"}
    conn = put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/new-page.md", body)
    data = json_response(conn, 200)["data"]
    assert data["path"] == "new-page.md"
    assert is_binary(data["commit"])
  end

  test "POST move renames a page" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/old.md", %{"frontmatter" => %{}, "body" => "x"})
    conn = post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/move", %{"from" => "old.md", "to" => "sub/new.md"})
    assert json_response(conn, 200)["data"]["path"] == "sub/new.md"
  end

  test "DELETE removes a page" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/temp.md", %{"frontmatter" => %{}, "body" => "x"})
    conn = delete(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/temp.md")
    assert json_response(conn, 200)["data"]["path"] == "temp.md"
  end

  test "POST asset stores an image and returns a relative link" do
    upload = %Plug.Upload{path: write_tmp_png(), filename: "logo.png", content_type: "image/png"}
    conn = post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/assets", %{"file" => upload, "page_path" => "index.md"})
    data = json_response(conn, 201)["data"]
    assert String.starts_with?(data["asset_path"], "assets/")
    assert data["markdown_link"] == data["asset_path"]
  end

  test "PUT with traversal path is rejected" do
    conn = put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/notes.txt", %{"frontmatter" => %{}, "body" => "x"})
    assert json_response(conn, 422)["error"]["code"] == "kb_invalid_path"
  end
```

Add helper `defp write_tmp_png, do: (p = Path.join(System.tmp_dir!(), "kb-#{System.unique_integer([:positive])}.png"); File.write!(p, <<137,80,78,71,13,10,26,10>>); p)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs`
Expected: FAIL (actions/routes missing).

- [ ] **Step 4: Write minimal implementation** (add to the controller)

```elixir
  @spec save_page(Conn.t(), map()) :: Conn.t()
  def save_page(conn, %{"project_slug" => slug, "repo" => repo, "path" => path} = params) do
    page = %{frontmatter: Map.get(params, "frontmatter", %{}) || %{}, body: to_string(Map.get(params, "body", ""))}

    case KnowledgeBase.write_page(slug, repo, path, page) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete_page(Conn.t(), map()) :: Conn.t()
  def delete_page(conn, %{"project_slug" => slug, "repo" => repo, "path" => path}) do
    case KnowledgeBase.delete_page(slug, repo, path) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec move_page(Conn.t(), map()) :: Conn.t()
  def move_page(conn, %{"project_slug" => slug, "repo" => repo, "from" => from, "to" => to}) do
    case KnowledgeBase.move_page(slug, repo, String.split(from, "/"), String.split(to, "/")) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def move_page(conn, _params), do: TrackerErrors.render(conn, :kb_invalid_path)

  @spec upload_asset(Conn.t(), map()) :: Conn.t()
  def upload_asset(conn, %{"project_slug" => slug, "repo" => repo, "file" => %Plug.Upload{} = upload} = params) do
    with {:ok, bytes} <- File.read(upload.path),
         {:ok, result} <-
           KnowledgeBase.store_asset(slug, repo, upload.filename || "asset.png", bytes, page_path: params["page_path"]) do
      conn |> put_status(:created) |> json(%{data: result})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def upload_asset(conn, _params), do: TrackerErrors.render(conn, :kb_unsupported_asset)
```

Add `alias Plug.Upload` is not needed (struct matched inline). Ensure `KnowledgeBase` alias already present from M1.

- [ ] **Step 5: Run test to verify it passes**

Run: `mix test test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/knowledge_base_controller.ex elixir/lib/symphony_elixir_web/router.ex elixir/test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs
git commit -m "feat(kb): add page write/move/delete and asset upload endpoints"
```

---

## Task 9: Milestone verification

- [ ] **Step 1:** `mix format --check-formatted` (run `mix format` + recommit if needed)
- [ ] **Step 2:** `mix compile --warnings-as-errors`
- [ ] **Step 3:** `mix test test/symphony_elixir/knowledge_base test/symphony_elixir/knowledge_base_test.exs test/symphony_elixir_web/controllers/tracker/knowledge_base_write_controller_test.exs test/symphony_elixir_web/tracker_errors_test.exs` -> all pass
- [ ] **Step 4:** commit any formatting fixes (`chore(kb): format milestone 2`).

---

## Self-Review

**Spec coverage (M2):**

| Spec requirement | Task |
|---|---|
| D6 Auto-commit, default branch `symphony-docs` | Tasks 1-2 (worktree), Task 6 (commit) |
| Section 5 frontmatter as YAML | Task 4 (`Frontmatter.serialize`) |
| Section 6 assets pasted/uploaded into `docs/assets/`, relative link | Task 5 (`Assets`), Task 6 (`store_asset`), Task 8 (`upload_asset`) |
| Section 7 auto-commit flow (validate -> write -> stage scoped -> commit -> push -> surface failures) | Task 6 (`Writer.stage_and_commit` + `maybe_push`), Task 7 (errors) |
| Section 8 endpoints `PUT pages/*path`, `POST assets` (+ move/delete) | Task 8 |
| Section 11 `commit_failed`, asset validation | Task 7 |
| Section 12 stage only KB files; reject `..`/absolute | Task 6 (scoped `git add docs/<rel>`), Paths validation reused |

**Deferred:** branch sync + PR/auto-merge (M4), so push failures here are tolerated (`pushed: false`) and reconciled by M4. Per-repo branch override deferred (schema column). Search indexing (M3) hooks into write events later via `kb_event`.

**Placeholder scan:** No TBD/TODO. Two explicit version-compatibility notes (`ymlr` function name in Task 4; `Path.relative_to/3` in Task 5) include concrete fallbacks.

**Type consistency:** `ws` map `%{worktree, docs_root, branch}` is produced by `Workspace.ensure/2` and consumed by all `Writer` functions and the context. `Paths.resolve_page_in/2` + `safe_relative_path/1` are reused across read (M1) and write paths. Error atoms added to both the context typespec and `TrackerErrors`.

---

## Execution handoff (Cursor)

```markdown
Documents:
- Spec: `docs/superpowers/specs/2026-06-25-knowledge-base-design.md`
- Plan: `docs/superpowers/plans/2026-06-25-knowledge-base-02-editing-autocommit.md`
```

1. **Task-per-session (recommended)** - one task per subagent, review between tasks.
2. **Inline** - run tasks here with checkpoints after each task.
