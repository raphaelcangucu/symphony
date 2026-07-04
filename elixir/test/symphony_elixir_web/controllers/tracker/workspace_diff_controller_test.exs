defmodule SymphonyElixirWeb.Tracker.WorkspaceDiffControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

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

    assert %{"data" => [%{"repo" => "advising", "files" => files}], "workspace" => workspace} =
             json_response(conn, 200)

    assert workspace["available"] == true
    paths = Enum.map(files, & &1["path"]) |> Enum.sort()
    assert paths == ["README.md", "new.txt"]
  end

  test "invalid diff type returns validation error", %{issue: issue} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/diff?type=nope"
      )

    assert %{"error" => %{"code" => "invalid_diff_type"}} = json_response(conn, 422)
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
end
