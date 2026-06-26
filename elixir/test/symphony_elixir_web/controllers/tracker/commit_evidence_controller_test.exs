defmodule SymphonyElixirWeb.Tracker.CommitEvidenceControllerTest do
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

    {:ok, project} = Context.ensure_project(%{name: "ADV", slug: "advising"})

    {:ok, _setup} =
      Context.upsert_project_setup("advising", %{
        "workflow_markdown" => """
        ---
        workspace:
          root: #{tmp_dir}
        ---
        """
      })

    {:ok, issue} = Context.create_issue("advising", %{"title" => "Commit evidence", "status" => "Todo"})

    repo = Path.join(tmp_dir, "repo")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b pre-release")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/symphony")
    sh!(repo, "echo work > work.txt && git add work.txt && git commit -m 'feat: agent work'")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/pre-release pre-release")
    sh!(repo, "git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/pre-release")

    workspace = Path.join([tmp_dir, "advising", issue.identifier])
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    %{project: project, issue: issue, workspace: workspace}
  end

  test "index lists commits from the issue workspace", ctx do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/commit_evidence"
      )

    assert %{"data" => [commit], "workspace" => workspace} = json_response(conn, 200)
    assert workspace["available"] == true
    assert commit["repo"] == "advising"
    assert commit["message"] =~ "agent work"
  end

  test "index lists commits via project repository default_branch without origin/HEAD", %{tmp_dir: tmp_dir} do
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

    assert {:ok, _repos} =
             Context.replace_repositories("advising", [
               %{
                 "github_full_name" => "org/advising",
                 "clone_url" => "https://github.com/org/advising.git",
                 "default_branch" => "pre-release",
                 "selected_branch" => "pre-release",
                 "workspace_path" => "advising",
                 "role" => "app"
               }
             ])

    {:ok, issue} = Context.create_issue("advising", %{"title" => "Shallow clone", "status" => "Todo"})

    repo = Path.join(tmp_dir, "repo-advising")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b pre-release")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/symphony")
    sh!(repo, "echo work > work.txt && git add work.txt && git commit -m 'feat: agent work'")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/pre-release pre-release")
    # Shallow-clone style: no origin/HEAD symbolic ref.

    workspace = Path.join([tmp_dir, "advising", issue.identifier])
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{issue.identifier}/commit_evidence"
      )

    assert %{"data" => [commit], "workspace" => workspace_info} = json_response(conn, 200)
    assert workspace_info["available"] == true
    assert commit["repo"] == "advising"
    assert commit["message"] =~ "agent work"
  end

  test "show returns commit file patches", ctx do
    index =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/commit_evidence"
      )
      |> json_response(200)

    [commit | _] = index["data"]

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/advising/issues/#{ctx.issue.identifier}/commit_evidence/#{commit["repo"]}/#{commit["sha"]}"
      )

    assert %{"data" => detail} = json_response(conn, 200)
    assert detail["message"] =~ "agent work"
    assert [%{"path" => "work.txt", "patch" => patch} | _] = detail["files"]
    assert patch =~ "work.txt"
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
