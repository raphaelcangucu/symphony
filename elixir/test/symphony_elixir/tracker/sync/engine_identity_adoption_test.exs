defmodule SymphonyElixir.Tracker.Sync.EngineIdentityAdoptionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, OutboxEntry}

  # Models a JIRA-style driver: `issue:create` returns the created identity map
  # (remote id + tracker-issued key) so the engine can adopt the remote key as
  # the local identifier. Other entries push against payload["identifier"] and
  # fail unless it is the remote key — exactly the 404 the adoption prevents.
  defmodule JiraLikeDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @remote_id "94607"
    @remote_key "CDE-1182"

    def remote_id, do: @remote_id
    def remote_key, do: @remote_key

    @impl true
    def push(_project, %OutboxEntry{entity_type: "issue", operation: "create"}) do
      {:ok, %{remote_id: @remote_id, identifier: @remote_key, url: "https://jira.test/browse/#{@remote_key}"}}
    end

    def push(_project, %OutboxEntry{payload: %{"identifier" => @remote_key}} = entry) do
      send(self(), {:pushed_with_remote_key, entry.entity_type, entry.operation})
      {:ok, nil}
    end

    def push(_project, %OutboxEntry{payload: %{"identifier" => other}}) do
      {:error, {:issue_not_found, other}}
    end

    @impl true
    def pull(_project, _opts), do: {:ok, []}

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Advising", slug: "advising-test"})
    %{project: project}
  end

  test "issue create adopts the JIRA-issued key as the local identifier and rewrites queued writes",
       %{project: project} do
    {:ok, draft} = Context.create_issue(project.slug, %{title: "Validation issue", description: "body"})
    placeholder = draft.identifier
    refute placeholder == JiraLikeDriver.remote_key()

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: draft.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Validation issue", "description" => "body"},
        dedup_key: "issue:create:#{project.id}:#{placeholder}"
      })

    # Queued BEFORE the create pushes — referencing the placeholder identifier,
    # exactly like the labels/status writes that 404ed against JIRA.
    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: draft.id,
        entity_type: "state",
        operation: "move",
        payload: %{"identifier" => placeholder, "state" => "Selected for Development"},
        dedup_key: "state:move:#{project.id}:#{placeholder}"
      })

    assert {:ok, summary} = Engine.sync_project(project, driver: JiraLikeDriver)
    assert summary.pushed == 2

    # The local row now carries the remote identity.
    reloaded = Repo.get!(IssueRecord, draft.id)
    assert reloaded.identifier == JiraLikeDriver.remote_key()
    assert reloaded.remote_id == JiraLikeDriver.remote_id()
    assert reloaded.url == "https://jira.test/browse/#{JiraLikeDriver.remote_key()}"

    # The queued move was rewritten to the remote key before pushing, so the
    # driver accepted it instead of 404ing on the placeholder.
    assert_received {:pushed_with_remote_key, "state", "move"}
  end

  test "adoption is skipped when the remote key is already mirrored by another row",
       %{project: project} do
    {:ok, _existing} =
      Context.create_issue(project.slug, %{title: "Mirrored earlier"})
      |> then(fn {:ok, issue} ->
        issue
        |> IssueRecord.changeset(%{identifier: JiraLikeDriver.remote_key(), dirty_fields: %{}})
        |> Repo.update()
      end)

    {:ok, draft} = Context.create_issue(project.slug, %{title: "Duplicate create", description: "body"})
    placeholder = draft.identifier

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: draft.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Duplicate create", "description" => "body"},
        dedup_key: "issue:create:#{project.id}:#{placeholder}"
      })

    assert {:ok, _summary} = Engine.sync_project(project, driver: JiraLikeDriver)

    # The remote id is linked, but the identifier is left alone to avoid a
    # duplicate-key collision with the already-mirrored row.
    reloaded = Repo.get!(IssueRecord, draft.id)
    assert reloaded.identifier == placeholder
    assert reloaded.remote_id == JiraLikeDriver.remote_id()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
