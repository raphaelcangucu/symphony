defmodule SymphonyElixir.Linear.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.Linear.SyncDriver
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok, [IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: "t", status: %{name: "Todo"}, updated_at: "2026-06-01T00:00:00Z"})]}
    end

    def move_issue(_project, _id, %{"status" => state}), do: {:ok, IssueDTO.build(%{id: "LIN_1", identifier: "MM-12", title: state, status: %{name: state}})}
  end

  defmodule StubComments do
    def create(issue_remote_id, body) do
      send(self(), {:comment_create, issue_remote_id, body})
      {:ok, "cmt-1"}
    end

    def update(comment_remote_id, body) do
      send(self(), {:comment_update, comment_remote_id, body})
      {:ok, comment_remote_id}
    end
  end

  setup do
    Application.put_env(:symphony_elixir, :linear_sync_adapter, StubAdapter)
    Application.put_env(:symphony_elixir, :linear_comments_module, StubComments)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :linear_sync_adapter)
      Application.delete_env(:symphony_elixir, :linear_comments_module)
    end)

    %{project: %Project{id: 1, slug: "mm", tracker_config: %{}}}
  end

  test "pull normalizes issues with no comments", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "LIN_1"
    assert issue.comments == []
  end

  test "pull_pull_requests is empty (GitHub owns source control)", %{project: project} do
    assert {:ok, []} = SyncDriver.pull_pull_requests(project, %IssueRecord{identifier: "MM-12"})
  end

  test "push state move delegates to move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "MM-12", "state" => "Done"}}
    assert {:ok, "LIN_1"} = SyncDriver.push(project, entry)
  end

  test "push comment create resolves the issue remote id and returns the comment id", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "create",
      payload: %{"identifier" => "MM-12", "body" => "## Codex Workpad\nv1", "comment_id" => 7},
      issue: %IssueRecord{remote_id: "LIN_UUID"}
    }

    assert {:ok, "cmt-1"} = SyncDriver.push(project, entry)
    assert_received {:comment_create, "LIN_UUID", "## Codex Workpad\nv1"}
  end

  test "push comment create without an issue remote id errors", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "create",
      payload: %{"identifier" => "MM-12", "body" => "b", "comment_id" => 7},
      issue: %IssueRecord{remote_id: nil}
    }

    assert {:error, :issue_remote_id_unknown} = SyncDriver.push(project, entry)
  end

  test "push comment update edits in place via the remote id", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "update",
      payload: %{"identifier" => "MM-12", "body" => "v2", "comment_id" => 7, "remote_id" => "cmt-1"}
    }

    assert {:ok, "cmt-1"} = SyncDriver.push(project, entry)
    assert_received {:comment_update, "cmt-1", "v2"}
  end

  test "push comment update without remote id degrades to create", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "update",
      payload: %{"identifier" => "MM-12", "body" => "v2", "comment_id" => 7, "remote_id" => nil},
      issue: %IssueRecord{remote_id: "LIN_UUID"}
    }

    assert {:ok, "cmt-1"} = SyncDriver.push(project, entry)
    assert_received {:comment_create, "LIN_UUID", "v2"}
  end

  test "unsupported pushes still error", %{project: project} do
    entry = %OutboxEntry{entity_type: "label", operation: "add", payload: %{}}
    assert {:error, {:unsupported_push, "label", "add"}} = SyncDriver.push(project, entry)
  end

  describe "evidence artifact upload on comment push" do
    @describetag :tmp_dir

    setup %{tmp_dir: tmp_dir} do
      {:ok, _repo, _apps} =
        Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

      SymphonyElixir.TestSupport.truncate_tracker!(Repo)
      {:ok, _project} = Context.ensure_project(%{name: "MM", slug: "mm"})

      workspace = Path.join(tmp_dir, "ws")
      evidence_dir = Path.join(workspace, ".symphony/evidence/artifacts")
      File.mkdir_p!(evidence_dir)
      File.write!(Path.join(workspace, ".symphony/evidence/manifest.json"), Jason.encode!(%{"runs" => []}))
      File.write!(Path.join(evidence_dir, "s.png"), "img")

      {:ok, record} =
        Store.persist("mm", "MM-12", workspace, %{"runs" => []}, evidence_root: Path.join(tmp_dir, "durable"))

      Application.put_env(:symphony_elixir, :linear_artifact_uploader, fn _path, filename, _ct ->
        {:ok, "https://uploads.linear.app/#{filename}"}
      end)

      on_exit(fn -> Application.delete_env(:symphony_elixir, :linear_artifact_uploader) end)

      url = "http://localhost:4000/api/tracker/v1/projects/mm/issues/MM-12/evidence/#{record.run_id}/artifacts/artifacts/s.png"
      %{url: url}
    end

    test "comment create uploads artifacts and pushes the Linear-hosted URL", %{project: project, url: url} do
      entry = %OutboxEntry{
        entity_type: "comment",
        operation: "create",
        payload: %{"identifier" => "MM-12", "body" => "## Codex Evidence\n![s.png](#{url})"},
        issue: %IssueRecord{remote_id: "LIN_UUID"}
      }

      assert {:ok, "cmt-1"} = SyncDriver.push(project, entry)
      assert_received {:comment_create, "LIN_UUID", body}
      assert body =~ "![s.png](https://uploads.linear.app/s.png)"
      refute body =~ "/api/tracker/v1/"
    end
  end
end
