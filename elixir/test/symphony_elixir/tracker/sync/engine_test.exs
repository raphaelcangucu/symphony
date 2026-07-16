defmodule SymphonyElixir.Tracker.Sync.EngineTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, OutboxEntry, StateRecord}

  defmodule FakeDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts) do
      send(self(), {:fake_pull, :called})

      {:ok,
       [
         %{
           remote_id: "I_1",
           remote_number: 1,
           identifier: "1",
           title: "Pulled issue",
           description: "body",
           state: "Todo",
           priority: nil,
           assignee_id: nil,
           branch_name: nil,
           remote_url: "u",
           creator: "octo",
           position: 0,
           remote_updated_at: DateTime.utc_now(),
           labels: [],
           comments: []
         }
       ]}
    end

    @impl true
    def push(_project, %OutboxEntry{} = entry) do
      send(self(), {:fake_push, entry.dedup_key})
      {:ok, "REMOTE_#{entry.id}"}
    end

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, [%{remote_id: "PR_1", number: 7, url: "u", title: "t", state: "open"}]}
  end

  defmodule FakeRemoteAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    alias SymphonyElixir.Tracker.IssueDTO

    @impl true
    def kind, do: :github

    @impl true
    def get_issue(_project, identifier) do
      {:ok,
       IssueDTO.build(%{
         id: "I_#{identifier}",
         identifier: identifier,
         title: "Remote issue #{identifier}",
         description: "body",
         status: %{name: "Todo"},
         updated_at: "2026-06-01T00:00:00Z"
       })}
    end

    @impl true
    def list_comments(_project, _identifier) do
      {:ok,
       [
         %{id: "IC_pad", body: "## Codex Workpad\n- plan", author: "codex", kind: "workpad", updated_at: "2026-06-02T00:00:00Z"},
         %{id: "IC_msg", body: "looks good", author: "octocat", kind: "comment", updated_at: "2026-06-02T01:00:00Z"}
       ]}
    end

    @impl true
    def list_issues(_project, _filters), do: {:ok, []}
    @impl true
    def create_issue(_project, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def update_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def move_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def list_statuses(_project), do: {:ok, []}
    @impl true
    def list_labels(_project), do: {:ok, []}
    @impl true
    def list_assignable_users(_project), do: {:ok, []}
    @impl true
    def add_comment(_project, _identifier, _body, _opts), do: {:error, :not_supported_on_remote}
    def update_comment(_project, _identifier, _comment_id, _body), do: {:error, :not_supported_on_remote}
    def delete_comment(_project, _identifier, _comment_id), do: {:error, :not_supported_on_remote}
  end

  defmodule MissingRemoteAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    @impl true
    def kind, do: :github

    @impl true
    def get_issue(_project, _identifier), do: {:error, :issue_not_found}

    @impl true
    def list_comments(_project, _identifier), do: {:ok, []}

    @impl true
    def list_issues(_project, _filters), do: {:ok, []}

    @impl true
    def create_issue(_project, _attrs), do: {:error, :not_supported_on_remote}

    @impl true
    def update_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

    @impl true
    def move_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

    @impl true
    def list_statuses(_project), do: {:ok, []}

    @impl true
    def list_labels(_project), do: {:ok, []}

    @impl true
    def list_assignable_users(_project), do: {:ok, []}

    @impl true
    def add_comment(_project, _identifier, _body, _opts), do: {:error, :not_supported_on_remote}

    @impl true
    def update_comment(_project, _identifier, _comment_id, _body), do: {:error, :not_supported_on_remote}

    @impl true
    def delete_comment(_project, _identifier, _comment_id), do: {:error, :not_supported_on_remote}
  end

  defmodule LocalAliasBoardClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => [
                 %{
                   "id" => "PVTI_288",
                   "content" => %{
                     "__typename" => "Issue",
                     "id" => "I_back_288",
                     "number" => 288,
                     "title" => "DAR withdrawal cap",
                     "body" => "remote body",
                     "url" => "https://github.com/clouapp/back/issues/288",
                     "repository" => %{"nameWithOwner" => "clouapp/back"},
                     "assignees" => %{"nodes" => []},
                     "labels" => %{"nodes" => []},
                     "createdAt" => "2026-06-25T00:00:00Z",
                     "updatedAt" => "2026-06-26T00:00:00Z"
                   },
                   "fieldValues" => %{
                     "nodes" => [
                       %{
                         "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                         "name" => "In Progress",
                         "field" => %{"name" => "Symphony State"}
                       }
                     ]
                   }
                 }
               ],
               "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
             }
           }
         }
       }}
    end
  end

  defmodule MixedStateDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts), do: {:ok, [issue("1", "Todo"), issue("2", "Done")]}

    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}

    defp issue(id, state) do
      %{
        remote_id: "I_#{id}",
        remote_number: String.to_integer(id),
        identifier: id,
        title: "Issue #{id}",
        description: "body",
        state: state,
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "u",
        creator: "octo",
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      }
    end
  end

  defmodule RecordingPrDriver do
    def pull_pull_requests(_project, issue) do
      send(self(), {:pr_pull, issue.identifier})
      {:ok, [%{remote_id: "PR_1", number: 7, url: "u", title: "t", state: "open"}]}
    end
  end

  # Models the create-then-pull race: the issue-create push returns the remote
  # node id the freshly created remote issue will carry, and the subsequent pull
  # mirrors that same issue (matching `remote_id`). Used to prove the local draft
  # is linked on push so the pull reconciles it in place instead of duplicating.
  defmodule CreateLinkDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @remote_id "I_CREATED"
    @remote_number 1851

    def remote_id, do: @remote_id

    @impl true
    def push(_project, %OutboxEntry{entity_type: "issue", operation: "create"}), do: {:ok, @remote_id}
    def push(_project, %OutboxEntry{} = entry), do: {:ok, "REMOTE_#{entry.id}"}

    @impl true
    def pull(_project, _opts) do
      {:ok,
       [
         %{
           remote_id: @remote_id,
           remote_number: @remote_number,
           identifier: to_string(@remote_number),
           title: "Draft title",
           description: "body",
           state: "Todo",
           priority: nil,
           assignee_id: nil,
           branch_name: nil,
           remote_url: "https://example.test/issues/#{@remote_number}",
           creator: "octo",
           position: 0,
           remote_updated_at: DateTime.utc_now(),
           labels: [],
           comments: []
         }
       ]}
    end

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  # Models an external change: the remote keeps a child in "Done" while the parent
  # is still "Todo". After the pull, the engine reconciles the parent up to its
  # least-advanced child and enqueues the resulting parent push.
  defmodule RollupPullDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts), do: {:ok, [issue("10", "Todo"), issue("11", "Done")]}

    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}

    defp issue(id, state) do
      %{
        remote_id: "I_#{id}",
        remote_number: String.to_integer(id),
        identifier: id,
        title: "Issue #{id}",
        description: "body",
        state: state,
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "u",
        creator: "octo",
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      }
    end
  end

  @enrich_table :symphony_tracker_enrich_ttl

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "sync_project pushes outbox entries then pulls remote issues", %{project: project} do
    {:ok, _} =
      Outbox.enqueue(%{project_id: project.id, entity_type: "state", operation: "move", payload: %{"state" => "Done"}, dedup_key: "k1"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FakeDriver)

    assert_received {:fake_push, "k1"}
    assert_received {:fake_pull, :called}
    assert summary.pushed == 1
    assert summary.pulled == 1

    assert Outbox.pending_count(project.id) == 0
    assert Repo.aggregate(IssueRecord, :count) == 1
    state = Repo.get_by(StateRecord, project_id: project.id)
    assert state.status == "idle"
    refute is_nil(state.last_pull_at)
  end

  test "sync_project rolls a parent up after a pull moves its child and enqueues the parent push", %{project: project} do
    # Seed both issues from the remote, then declare the parent/child link locally.
    assert {:ok, _} = Engine.sync_project(project, driver: RollupPullDriver, force: true)
    {:ok, _} = Context.set_issue_parent(project.slug, "11", "10")

    # A second pull leaves the child in Done; the post-pull reconcile rolls the
    # parent up to follow its only child.
    assert {:ok, _} = Engine.sync_project(project, driver: RollupPullDriver, force: true)

    assert {:ok, parent} = Context.get_issue(project.slug, "10")
    assert parent.status.name == "Done"

    entries = Outbox.claim_pending(project.id, 10)
    assert Enum.any?(entries, &(&1.payload["identifier"] == "10" and &1.payload["state"] == "Done"))
  end

  test "sync_project stores pull requests for pulled issues", %{project: project} do
    assert {:ok, _summary} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert Enum.map(prs, & &1.remote_id) == ["PR_1"]
  end

  test "a failing push marks the entry failed without aborting the pull", %{project: project} do
    defmodule FailPushDriver do
      @behaviour SymphonyElixir.Tracker.Sync.Driver
      @impl true
      def pull(_p, _o), do: {:ok, []}
      @impl true
      def push(_p, _e), do: {:error, "boom"}
      @impl true
      def pull_pull_requests(_p, _i), do: {:ok, []}
    end

    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{}, dedup_key: "c"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FailPushDriver, max_attempts: 1)
    assert summary.failed == 1
    failed = Repo.one(OutboxEntry)
    assert failed.status == "failed"
  end

  test "a pushed comment-create records the remote id on the local comment", %{project: project} do
    {:ok, issue} =
      SymphonyElixir.Tracker.Sync.LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_42",
        remote_number: 42,
        identifier: "42",
        title: "t",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: nil,
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    {:ok, comment} =
      %SymphonyElixir.LocalTracker.Comment{}
      |> SymphonyElixir.LocalTracker.Comment.changeset(%{
        issue_id: issue.id,
        kind: "comment",
        body: "hi remote",
        author: "raphael"
      })
      |> Repo.insert()

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: issue.id,
        entity_type: "comment",
        operation: "create",
        payload: %{"identifier" => "42", "body" => "hi remote", "comment_id" => comment.id},
        dedup_key: nil
      })

    assert {:ok, _summary} = Engine.sync_project(project, driver: FakeDriver)

    reloaded = Repo.get(SymphonyElixir.LocalTracker.Comment, comment.id)
    refute is_nil(reloaded.remote_id)
    assert String.starts_with?(reloaded.remote_id, "REMOTE_")
    assert reloaded.sync_status == "synced"
  end

  test "a pushed state move clears the state dirty field", %{project: project} do
    {:ok, issue} =
      SymphonyElixir.Tracker.Sync.LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_1",
        remote_number: 1,
        identifier: "1",
        title: "t",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: nil,
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    assert {:ok, _dirty} = SymphonyElixir.Tracker.Sync.LocalStore.mark_dirty(issue.identifier, project.slug, [:state])

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: issue.id,
        entity_type: "state",
        operation: "move",
        payload: %{"identifier" => issue.identifier, "state" => "Done"},
        dedup_key: "state:move:#{project.id}:#{issue.identifier}"
      })

    assert {:ok, _summary} = Engine.sync_project(project, driver: FakeDriver)

    reloaded = Repo.get!(IssueRecord, issue.id)
    refute Map.has_key?(reloaded.dirty_fields || %{}, "state")
  end

  test "a pushed issue-create links the remote id onto the local draft so the pull does not duplicate it",
       %{project: project} do
    {:ok, draft} = Context.create_issue(project.slug, %{title: "Draft title", description: "body"})
    assert is_nil(draft.remote_id)

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: draft.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Draft title", "description" => "body"},
        dedup_key: "issue:create:#{project.id}:#{draft.identifier}"
      })

    assert {:ok, summary} = Engine.sync_project(project, driver: CreateLinkDriver)
    assert summary.pushed == 1

    # The pull mirrors the just-created remote issue. Because the draft was linked
    # to its remote id on push, the pull reconciles onto it instead of inserting a
    # second row, so the board shows a single card.
    assert Repo.aggregate(IssueRecord, :count) == 1

    reloaded = Repo.get(IssueRecord, draft.id)
    assert reloaded.remote_id == CreateLinkDriver.remote_id()
    assert reloaded.remote_number == 1851
  end

  test "sync_issue force-pulls one issue with classified comments and its PRs" do
    prev_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => FakeRemoteAdapter})
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      restore_env(:issue_adapters, prev_adapters)
      restore_env(:tracker, prev_tracker)
    end)

    {:ok, project} =
      Context.ensure_project(%{
        name: "Front",
        slug: "front",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/front", "project_id" => "PVT_1"}
      })

    assert {:ok, issue} = Engine.sync_issue(project, "510", pr_driver: FakeDriver)
    assert issue.identifier == "510"

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:comments)
    kinds = loaded.comments |> Enum.map(&{&1.remote_id, &1.kind}) |> Map.new()
    assert kinds["IC_pad"] == "workpad"
    assert kinds["IC_msg"] == "comment"

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert Enum.map(prs, & &1.remote_id) == ["PR_1"]
  end

  test "sync_issue resolves local Symphony aliases through the GitHub adapter" do
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    Application.put_env(:symphony_elixir, :github_client_module, LocalAliasBoardClientStub)

    on_exit(fn ->
      restore_env(:tracker, prev_tracker)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "Macro Markets",
        slug: "macro-markets-sync",
        tracker_kind: "github",
        tracker_config: %{
          "repo" => "clouapp/front",
          "project_id" => "PVT_1",
          "status_field" => "Symphony State"
        }
      })

    {:ok, _repos} =
      Context.replace_repositories("macro-markets-sync", [
        %{"github_full_name" => "clouapp/front", "workspace_path" => "front", "role" => "primary"},
        %{"github_full_name" => "clouapp/back", "workspace_path" => "back", "role" => "backend"}
      ])

    {:ok, issue} = Context.create_issue("macro-markets-sync", %{title: "Draft", status: "Todo"})

    issue
    |> IssueRecord.changeset(%{
      remote_number: 288,
      remote_id: "I_back_288",
      remote_url: "https://github.com/clouapp/back/issues/288",
      url: "https://github.com/clouapp/back/issues/288"
    })
    |> Repo.update!()

    assert {:ok, synced} = Engine.sync_issue(project, issue.identifier, pr_driver: FakeDriver)
    assert synced.identifier == issue.identifier
    assert synced.title == "DAR withdrawal cap"
    assert synced.remote_number == 288
  end

  test "sync_issue falls back to two-way sync when remote is missing but a local draft exists" do
    prev_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => MissingRemoteAdapter})
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      restore_env(:issue_adapters, prev_adapters)
      restore_env(:tracker, prev_tracker)
    end)

    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba-sync-fallback",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/gamba", "project_id" => "PVT_1"}
      })

    {:ok, draft} = Context.create_issue(project.slug, %{title: "Draft title", description: "body"})
    assert is_nil(draft.remote_id)

    {:ok, _} =
      Outbox.enqueue(%{
        project_id: project.id,
        issue_id: draft.id,
        entity_type: "issue",
        operation: "create",
        payload: %{"title" => "Draft title", "description" => "body"},
        dedup_key: "issue:create:#{project.id}:#{draft.identifier}"
      })

    # Stuck mid-sync the way a crashed push leaves local-only drafts unclaimable.
    assert [%{status: "in_flight"}] = Outbox.claim_pending(project.id, 10)

    assert {:ok, synced} =
             Engine.sync_issue(project, draft.identifier, driver: CreateLinkDriver, force: true)

    assert synced.id == draft.id
    reloaded = Repo.get!(IssueRecord, draft.id)
    assert reloaded.remote_id == CreateLinkDriver.remote_id()
  end

  test "sync_issue still returns issue_not_found when neither remote nor local exists" do
    prev_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => MissingRemoteAdapter})
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      restore_env(:issue_adapters, prev_adapters)
      restore_env(:tracker, prev_tracker)
    end)

    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba-sync-missing",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/gamba", "project_id" => "PVT_1"}
      })

    assert {:error, :issue_not_found} =
             Engine.sync_issue(project, "GAM-404", driver: CreateLinkDriver, force: true)
  end

  test "sync_issue returns sync_push_failed when two-way create push cannot link a remote id" do
    prev_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => MissingRemoteAdapter})
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      restore_env(:issue_adapters, prev_adapters)
      restore_env(:tracker, prev_tracker)
    end)

    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba-sync-push-fail",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/gamba", "project_id" => "PVT_1"}
      })

    {:ok, draft} = Context.create_issue(project.slug, %{title: "Draft title", description: "body"})

    defmodule AlwaysFailPushDriver do
      @behaviour SymphonyElixir.Tracker.Sync.Driver

      @impl true
      def push(_project, _entry), do: {:error, :boom}

      @impl true
      def pull(_project, _opts), do: {:ok, []}

      @impl true
      def pull_pull_requests(_project, _issue), do: {:ok, []}
    end

    assert {:error, {:sync_push_failed, detail}} =
             Engine.sync_issue(project, draft.identifier, driver: AlwaysFailPushDriver, force: true, max_attempts: 1)

    assert is_binary(detail)
    assert detail =~ "boom"
  end

  test "sync_issue is not supported on local projects", %{project: project} do
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    on_exit(fn -> restore_env(:tracker, prev_tracker) end)

    assert {:error, :not_supported_on_remote} = Engine.sync_issue(project, "1")
  end

  test "sync_issue is disabled when local-first sync is off", %{project: project} do
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    on_exit(fn -> restore_env(:tracker, prev_tracker) end)

    assert {:error, :sync_disabled} = Engine.sync_issue(project, "1")
  end

  test "reset_orphaned_syncing flips stale 'syncing' rows to idle when sync is enabled", %{project: project} do
    prev = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    on_exit(fn -> restore_env(:tracker, prev) end)

    Repo.insert!(%StateRecord{project_id: project.id, status: "syncing"})

    assert Engine.reset_orphaned_syncing() == :ok
    assert Repo.get_by!(StateRecord, project_id: project.id).status == "idle"
  end

  test "reset_orphaned_syncing is a no-op when sync is disabled", %{project: project} do
    prev = Application.get_env(:symphony_elixir, :tracker)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: false)
    on_exit(fn -> restore_env(:tracker, prev) end)

    Repo.insert!(%StateRecord{project_id: project.id, status: "syncing"})

    assert Engine.reset_orphaned_syncing() == :ok
    assert Repo.get_by!(StateRecord, project_id: project.id).status == "syncing"
  end

  describe "coalescing and enrichment gates" do
    setup do
      prev_min = Application.get_env(:symphony_elixir, :tracker_sync_min_pull_ms)
      prev_ttl = Application.get_env(:symphony_elixir, :tracker_pr_sync_ttl_ms)
      reset_enrich_markers()

      on_exit(fn ->
        restore_env(:tracker_sync_min_pull_ms, prev_min)
        restore_env(:tracker_pr_sync_ttl_ms, prev_ttl)
      end)

      :ok
    end

    test "a second sync within the min pull interval is coalesced to push-only", %{project: project} do
      Application.put_env(:symphony_elixir, :tracker_sync_min_pull_ms, 60_000)

      assert {:ok, first} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)
      assert first.pulled == 1
      refute first.skipped_pull
      assert_received {:fake_pull, :called}

      assert {:ok, second} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)
      assert second.skipped_pull
      assert second.pulled == 0
      refute_received {:fake_pull, :called}
    end

    test "force bypasses the min pull interval", %{project: project} do
      Application.put_env(:symphony_elixir, :tracker_sync_min_pull_ms, 60_000)

      assert {:ok, _first} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)
      assert_received {:fake_pull, :called}

      assert {:ok, forced} =
               Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver, force: true)

      refute forced.skipped_pull
      assert forced.pulled == 1
      assert_received {:fake_pull, :called}
    end

    test "only active-state issues are enriched with pull requests", %{project: project} do
      assert {:ok, summary} =
               Engine.sync_project(project, driver: MixedStateDriver, pr_driver: RecordingPrDriver)

      assert summary.pulled == 2
      assert summary.enriched == 1

      assert_received {:pr_pull, "1"}
      refute_received {:pr_pull, "2"}

      prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
      assert Enum.map(prs, & &1.remote_id) == ["PR_1"]
    end

    test "enrichment is skipped for an issue re-enriched within the TTL", %{project: project} do
      Application.put_env(:symphony_elixir, :tracker_pr_sync_ttl_ms, 60_000)

      assert {:ok, first} =
               Engine.sync_project(project, driver: FakeDriver, pr_driver: RecordingPrDriver, force: true)

      assert first.enriched == 1
      assert_received {:pr_pull, "1"}

      assert {:ok, second} =
               Engine.sync_project(project, driver: FakeDriver, pr_driver: RecordingPrDriver, force: true)

      assert second.enriched == 0
      refute_received {:pr_pull, "1"}
    end
  end

  defp reset_enrich_markers do
    if :ets.whereis(@enrich_table) != :undefined, do: :ets.delete_all_objects(@enrich_table)
    :ok
  end

  defp restore_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_env(key, value), do: Application.put_env(:symphony_elixir, key, value)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
