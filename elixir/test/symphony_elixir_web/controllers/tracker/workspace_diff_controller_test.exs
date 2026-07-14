defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, _project} = Context.ensure_project(%{name: "ADV", slug: "advising"})

    {:ok, _setup} =
      Context.upsert_project_setup("advising", %{
        "workflow_markdown" => """
        ---
        workspace:
          root: #{tmp_dir}
        ---
        """
      })

    {:ok, issue} = Context.create_issue("advising", %{"title" => "Workspace diff", "status" => "Todo"})

    repo = Path.join(tmp_dir, "repo")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b main")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/symphony")
    sh!(repo, "echo dirty >> README.md && echo new > new.txt")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/main main")

    workspace = Path.join([tmp_dir, "advising", issue.identifier])
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    %{issue: issue, workspace: workspace}
  end

  test "show returns uncommitted workspace patches", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff?type=uncommitted"
      )

    response = json_response(conn, 200)

    assert %{"data" => [%{"repo" => "advising", "files" => files}], "workspace" => workspace} =
             response

    assert %{"repo" => _, "branch" => _, "base" => _, "ahead" => _, "behind" => _, "files" => _} =
             hd(response["data"])

    assert workspace["available"] == true
    paths = Enum.map(files, & &1["path"]) |> Enum.sort()
    assert paths == ["README.md", "new.txt"]
  end

  test "show reads persisted issue thread workspace with multiple repositories", %{
    issue: issue,
    workspace: computed_workspace,
    tmp_dir: tmp_dir
  } do
    persisted_workspace = Path.join(tmp_dir, "persisted")
    File.mkdir_p!(persisted_workspace)
    frontend = create_dirty_repo!(persisted_workspace, "frontend", "src/App.tsx")
    backend = create_dirty_repo!(persisted_workspace, "backend", "lib/app.ex")

    {:ok, _thread} =
      History.ensure_issue_thread("advising", issue.identifier, %{workspace_path: persisted_workspace})

    assert persisted_workspace != computed_workspace
    assert File.dir?(frontend)
    assert File.dir?(backend)

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff?type=uncommitted"
      )

    assert %{"data" => repos, "workspace" => %{"path" => ^persisted_workspace, "available" => true}} =
             json_response(conn, 200)

    assert repos |> Enum.map(& &1["repo"]) |> Enum.sort() == ["backend", "frontend"]
    assert %{"files" => [%{"path" => "lib/app.ex"}]} = Enum.find(repos, &(&1["repo"] == "backend"))
    assert %{"files" => [%{"path" => "src/App.tsx"}]} = Enum.find(repos, &(&1["repo"] == "frontend"))
  end

  test "invalid diff type returns validation error", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff?type=nope"
      )

    assert %{"error" => %{"code" => "invalid_diff_type"}} = json_response(conn, 422)
  end

  test "stats returns aggregate counters with no files/patches", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/stats?type=uncommitted"
      )

    assert %{"data" => [stat], "workspace" => %{"available" => true}} = json_response(conn, 200)
    assert stat["repo"] == "advising"
    assert stat["files_changed"] == 2
    assert stat["untracked"] == 1
    refute Map.has_key?(stat, "files")
  end

  test "stats rejects an invalid diff type", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/stats?type=nope"
      )

    assert %{"error" => %{"code" => "invalid_diff_type"}} = json_response(conn, 422)
  end

  test "files returns the merged, paged file list", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/files?type=uncommitted&limit=1"
      )

    assert %{"files" => [file], "total" => 2, "limit" => 1, "next_cursor" => cursor} = json_response(conn, 200)
    assert is_binary(cursor)
    refute Map.has_key?(file, "patch")

    next_conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/files?type=uncommitted&limit=1&cursor=#{cursor}"
      )

    assert %{"files" => [other_file], "next_cursor" => nil} = json_response(next_conn, 200)
    assert file["path"] != other_file["path"]
  end

  test "files filters by repo and q", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/files?type=uncommitted&repo=advising&q=readme"
      )

    assert %{"files" => [%{"path" => "README.md"}], "total" => 1} = json_response(conn, 200)
  end

  test "files rejects an invalid cursor", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/files?type=uncommitted&cursor=not-valid!!"
      )

    assert %{"error" => %{"code" => "invalid_cursor"}} = json_response(conn, 422)
  end

  test "patch returns the unified diff for exactly one file", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/patch?type=uncommitted&repo=advising&path=README.md"
      )

    assert %{"data" => data} = json_response(conn, 200)
    assert data["repo"] == "advising"
    assert data["path"] == "README.md"
    assert data["status"] == "modified"
    assert data["patch"] =~ "README.md"
  end

  test "patch rejects a path outside the repo", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/patch?type=uncommitted&repo=advising&path=../../etc/passwd"
      )

    assert %{"error" => %{"code" => "invalid_file_path"}} = json_response(conn, 422)
  end

  test "patch reports an unknown repo", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/patch?type=uncommitted&repo=nope&path=README.md"
      )

    assert %{"error" => %{"code" => "repo_not_found"}} = json_response(conn, 404)
  end

  test "commit creates commits for dirty workspace repos", %{issue: issue, workspace: workspace} do
    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/commit",
        %{"message" => "feat: save tracker diff"}
      )

    assert %{"data" => [%{"repo" => "advising", "sha" => sha, "message" => "feat: save tracker diff"}]} =
             json_response(conn, 200)

    assert String.length(sha) == 40

    repo = Path.join(workspace, "advising")
    assert sh!(repo, "git status --porcelain") == ""
    assert String.trim(sh!(repo, "git log -1 --format=%s")) == "feat: save tracker diff"
  end

  test "commit rejects blank messages", %{issue: issue} do
    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff/commit",
        %{"message" => " "}
      )

    assert %{"error" => %{"code" => "invalid_commit_message"}} = json_response(conn, 422)
  end

  test "stats_thread/files_thread/file_patch_thread proxy to the thread's workspace", %{tmp_dir: tmp_dir} do
    persisted_workspace = Path.join(tmp_dir, "thread-ws")
    File.mkdir_p!(persisted_workspace)
    create_dirty_repo!(persisted_workspace, "backend", "lib/app.ex")

    {:ok, thread} =
      History.ensure_issue_thread("advising", "THREAD-DIFF-1", %{workspace_path: persisted_workspace})

    stats_conn =
      get(authorized_conn(), "/api/tracker/v1/assistant/threads/#{thread.id}/diff/stats?type=uncommitted")

    assert %{"data" => [%{"repo" => "backend", "files_changed" => 1}]} = json_response(stats_conn, 200)

    files_conn =
      get(authorized_conn(), "/api/tracker/v1/assistant/threads/#{thread.id}/diff/files?type=uncommitted")

    assert %{"files" => [%{"repo" => "backend", "path" => "lib/app.ex"}]} = json_response(files_conn, 200)

    patch_conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/assistant/threads/#{thread.id}/diff/patch?type=uncommitted&repo=backend&path=lib/app.ex"
      )

    assert %{"data" => %{"path" => "lib/app.ex", "status" => "added"}} = json_response(patch_conn, 200)
  end

  test "stats_thread reports 404 for an unknown thread id" do
    conn = get(authorized_conn(), "/api/tracker/v1/assistant/threads/999999999/diff/stats?type=uncommitted")

    assert %{"error" => %{"code" => _}} = json_response(conn, 404)
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp sh!(cwd, command) do
    {output, status} = System.cmd("bash", ["-lc", command], cd: cwd, stderr_to_stdout: true)
    assert status == 0, output
    output
  end

  defp create_dirty_repo!(workspace, name, dirty_path) do
    repo = Path.join(workspace, name)
    File.mkdir_p!(repo)
    sh!(repo, "git init -b main")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    File.mkdir_p!(Path.dirname(Path.join(repo, dirty_path)))
    File.write!(Path.join(repo, dirty_path), "#{name}\n")
    repo
  end
end
