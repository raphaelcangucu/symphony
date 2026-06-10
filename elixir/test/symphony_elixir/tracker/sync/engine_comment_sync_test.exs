defmodule SymphonyElixir.Tracker.Sync.EngineCommentSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Comment, Context}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, OutboxEntry}

  defmodule OkDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts), do: {:ok, []}

    @impl true
    def push(_project, %OutboxEntry{}), do: {:ok, "remote-comment-1"}

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule FailDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts), do: {:ok, []}

    @impl true
    def push(_project, %OutboxEntry{}), do: {:error, :boom}

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    {:ok, issue} = Context.create_issue("mm", %{title: "Do the thing", status: "Todo"})
    %{project: project, issue: issue}
  end

  test "successful comment:create push links remote id and marks comment synced", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    {:ok, _} = SymphonyElixir.Tracker.Sync.LocalStore.mark_comment_sync_status(comment.id, "pending")

    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue.id,
      entity_type: "comment",
      operation: "create",
      payload: %{"identifier" => issue.identifier, "body" => comment.body, "comment_id" => comment.id},
      dedup_key: nil
    })

    assert {:ok, %{pushed: 1, failed: 0}} = Engine.sync_project(project, driver: OkDriver)

    reloaded = Repo.get!(Comment, comment.id)
    assert reloaded.remote_id == "remote-comment-1"
    assert reloaded.sync_status == "synced"
  end

  test "comment:update push marks comment synced", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    {:ok, _} = SymphonyElixir.Tracker.Sync.LocalStore.mark_comment_sync_status(comment.id, "pending")

    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue.id,
      entity_type: "comment",
      operation: "update",
      payload: %{
        "identifier" => issue.identifier,
        "body" => "v2",
        "comment_id" => comment.id,
        "remote_id" => "remote-comment-1"
      },
      dedup_key: "comment:update:#{project.id}:#{comment.id}"
    })

    assert {:ok, %{pushed: 1, failed: 0}} = Engine.sync_project(project, driver: OkDriver)
    assert Repo.get!(Comment, comment.id).sync_status == "synced"
  end

  test "exhausted failures mark comment sync_status error", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "x", %{})
    {:ok, _} = SymphonyElixir.Tracker.Sync.LocalStore.mark_comment_sync_status(comment.id, "pending")

    Outbox.enqueue(%{
      project_id: project.id,
      issue_id: issue.id,
      entity_type: "comment",
      operation: "create",
      payload: %{"identifier" => issue.identifier, "body" => "x", "comment_id" => comment.id},
      dedup_key: nil
    })

    Enum.each(1..5, fn _attempt ->
      Engine.sync_project(project, driver: FailDriver)
    end)

    assert Repo.get!(Comment, comment.id).sync_status == "error"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
