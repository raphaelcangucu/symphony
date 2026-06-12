defmodule SymphonyElixir.Jira.SyncDriverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.Jira.SyncDriver
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  defmodule StubAdapter do
    def list_issues(_project, _filters) do
      {:ok,
       [
         IssueDTO.build(%{
           id: "10001",
           identifier: "ABC-12",
           title: "t",
           status: %{name: "In Progress"},
           updated_at: "2026-06-01T00:00:00Z"
         })
       ]}
    end

    def list_comments(_project, identifier) do
      send(self(), {:jira_list_comments, identifier})
      {:ok, [%{remote_id: "c-1", body: "hi", author: "Bot", remote_updated_at: "2026-06-01T01:00:00Z"}]}
    end

    def move_issue(_project, _id, %{"status" => state}) do
      {:ok, IssueDTO.build(%{id: "10001", identifier: "ABC-12", title: state, status: %{name: state}})}
    end

    def add_comment(_project, _id, body, _attrs) do
      send(self(), {:jira_add_comment, body})
      {:ok, %{remote_id: "c-2", body: body, author: "Bot", remote_updated_at: "2026-06-01T02:00:00Z"}}
    end

    def create_issue(_project, _payload) do
      {:ok, IssueDTO.build(%{id: "10010", identifier: "ABC-99", title: "new"})}
    end

    def update_comment(_project, _id, remote_id, body) do
      send(self(), {:jira_update_comment, remote_id, body})
      {:ok, %{remote_id: remote_id, body: body, author: "Bot", remote_updated_at: "2026-06-01T03:00:00Z"}}
    end
  end

  setup do
    Application.put_env(:symphony_elixir, :jira_sync_adapter, StubAdapter)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :jira_sync_adapter) end)
    %{project: %Project{id: 1, slug: "acme", tracker_kind: "jira", tracker_config: %{"project_key" => "ABC"}}}
  end

  test "pull is light: normalizes issues without fetching comments per issue", %{project: project} do
    assert {:ok, [issue]} = SyncDriver.pull(project, [])
    assert issue.remote_id == "10001"
    # Comments are enriched lazily by the engine (active issues, TTL-gated), not
    # per-issue on every pull — this is what avoids the N+1 comment fetch.
    assert issue.comments == []
    refute_received {:jira_list_comments, _identifier}
  end

  test "push state/move delegates to move_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "state", operation: "move", payload: %{"identifier" => "ABC-12", "state" => "Done"}}
    assert {:ok, "10001"} = SyncDriver.push(project, entry)
  end

  test "push comment/create delegates to add_comment", %{project: project} do
    entry = %OutboxEntry{entity_type: "comment", operation: "create", payload: %{"identifier" => "ABC-12", "body" => "hi"}}
    assert {:ok, "c-2"} = SyncDriver.push(project, entry)
  end

  test "push comment/update edits the comment in place", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "update",
      payload: %{"identifier" => "ABC-12", "body" => "v2", "remote_id" => "c-1", "comment_id" => 7}
    }

    assert {:ok, "c-1"} = SyncDriver.push(project, entry)
    assert_received {:jira_update_comment, "c-1", "v2"}
  end

  test "push comment/update without remote id degrades to create", %{project: project} do
    entry = %OutboxEntry{
      entity_type: "comment",
      operation: "update",
      payload: %{"identifier" => "ABC-12", "body" => "v2", "remote_id" => nil, "comment_id" => 7}
    }

    assert {:ok, "c-2"} = SyncDriver.push(project, entry)
  end

  test "push issue/create delegates to create_issue", %{project: project} do
    entry = %OutboxEntry{entity_type: "issue", operation: "create", payload: %{"title" => "new"}}
    assert {:ok, "10010"} = SyncDriver.push(project, entry)
  end

  test "push rejects unsupported entity types", %{project: project} do
    entry = %OutboxEntry{entity_type: "label", operation: "create", payload: %{}}
    assert {:error, {:unsupported_push, "label", "create"}} = SyncDriver.push(project, entry)
  end

  test "pull_pull_requests is empty (GitHub owns source control)", %{project: project} do
    assert {:ok, []} = SyncDriver.pull_pull_requests(project, %IssueRecord{identifier: "ABC-12"})
  end

  describe "evidence artifact attachment on comment push" do
    @describetag :tmp_dir

    setup %{tmp_dir: tmp_dir, project: project} do
      {:ok, _repo, _apps} =
        Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

      SymphonyElixir.TestSupport.truncate_tracker!(Repo)
      {:ok, _project} = Context.ensure_project(%{name: "Acme", slug: project.slug})

      workspace = Path.join(tmp_dir, "ws")
      evidence_dir = Path.join(workspace, ".symphony/evidence/artifacts")
      File.mkdir_p!(evidence_dir)
      File.write!(Path.join(workspace, ".symphony/evidence/manifest.json"), Jason.encode!(%{"runs" => []}))
      File.write!(Path.join(evidence_dir, "s.png"), "img")

      {:ok, record} =
        Store.persist(project.slug, "ABC-12", workspace, %{"runs" => []}, evidence_root: Path.join(tmp_dir, "durable"))

      Application.put_env(:symphony_elixir, :jira_artifact_uploader, fn issue, _path, filename, _ct ->
        send(self(), {:jira_attach, issue, filename})
        {:ok, "https://acme.atlassian.net/rest/api/3/attachment/content/#{filename}"}
      end)

      on_exit(fn -> Application.delete_env(:symphony_elixir, :jira_artifact_uploader) end)

      url =
        "http://localhost:4000/api/tracker/v1/projects/#{project.slug}/issues/ABC-12/evidence/#{record.run_id}/artifacts/artifacts/s.png"

      %{url: url}
    end

    test "comment create attaches artifacts and pushes the Jira-hosted URL", %{project: project, url: url} do
      entry = %OutboxEntry{
        entity_type: "comment",
        operation: "create",
        payload: %{"identifier" => "ABC-12", "body" => "## Codex Evidence\n![s.png](#{url})"}
      }

      assert {:ok, "c-2"} = SyncDriver.push(project, entry)
      assert_received {:jira_attach, "ABC-12", "s.png"}
      assert_received {:jira_add_comment, body}
      assert body =~ "![s.png](https://acme.atlassian.net/rest/api/3/attachment/content/s.png)"
      refute body =~ "/api/tracker/v1/"
    end
  end
end
