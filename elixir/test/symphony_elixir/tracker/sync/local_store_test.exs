defmodule SymphonyElixir.Tracker.Sync.LocalStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.LocalStore

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  defp remote_issue(overrides) do
    Map.merge(
      %{
        remote_id: "I_1",
        remote_number: 507,
        identifier: "507",
        title: "Remote title",
        description: "Remote body",
        state: "Todo",
        priority: nil,
        assignee_id: "octocat",
        branch_name: nil,
        remote_url: "https://github.com/o/r/issues/507",
        creator: "octocat",
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      },
      overrides
    )
  end

  test "inserts a new remote issue mapped to a local status", %{project: project} do
    assert {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    assert issue.remote_id == "I_1"
    assert issue.identifier == "507"
    assert issue.title == "Remote title"
    assert issue.sync_status == "synced"
    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:status)
    assert loaded.status.name == "Todo"
  end

  test "upsert is idempotent on remote_id", %{project: project} do
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "Renamed remotely"}))

    issues = Repo.all(IssueRecord)
    assert length(issues) == 1
    assert hd(issues).title == "Renamed remotely"
  end

  test "associates labels by name and remote_id", %{project: project} do
    labels = [%{remote_id: "LA_1", name: "bug", color: "ff0000"}]
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{labels: labels}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:labels)
    assert Enum.map(loaded.labels, & &1.name) == ["bug"]
    assert Enum.map(loaded.labels, & &1.remote_id) == ["LA_1"]
  end

  test "mirrors remote comments", %{project: project} do
    comments = [%{remote_id: "IC_1", body: "hello", author: "octocat", remote_updated_at: DateTime.utc_now()}]
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{comments: comments}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:comments)
    assert Enum.map(loaded.comments, & &1.body) == ["hello"]
    assert Enum.map(loaded.comments, & &1.remote_id) == ["IC_1"]
  end

  test "preserves the workpad kind of a synced comment", %{project: project} do
    comments = [
      %{remote_id: "IC_pad", body: "## Codex Workpad", author: "bot", kind: "workpad", remote_updated_at: DateTime.utc_now()},
      %{remote_id: "IC_msg", body: "thanks", author: "octocat", kind: "comment", remote_updated_at: DateTime.utc_now()}
    ]

    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{comments: comments}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:comments)
    by_remote_id = Map.new(loaded.comments, &{&1.remote_id, &1.kind})

    assert by_remote_id["IC_pad"] == "workpad"
    assert by_remote_id["IC_msg"] == "comment"
  end

  test "adopts a local-only comment with a matching body instead of duplicating it", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    # A locally authored comment that was pushed to the remote but never had its
    # remote_id recorded locally (the source of the post-sync duplicate).
    {:ok, _orphan} =
      %SymphonyElixir.LocalTracker.Comment{}
      |> SymphonyElixir.LocalTracker.Comment.changeset(%{
        issue_id: issue.id,
        kind: "comment",
        body: "Temos um problema aqui",
        author: "raphael"
      })
      |> Repo.insert()

    comments = [
      %{remote_id: "IC_remote", body: "Temos um problema aqui", author: "raphael", kind: "comment", remote_updated_at: DateTime.utc_now()}
    ]

    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{comments: comments}))

    loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:comments)
    assert length(loaded.comments) == 1
    [comment] = loaded.comments
    assert comment.remote_id == "IC_remote"
    assert comment.sync_status == "synced"
  end

  test "link_comment_remote_id records the remote id on a locally authored comment", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    {:ok, comment} =
      %SymphonyElixir.LocalTracker.Comment{}
      |> SymphonyElixir.LocalTracker.Comment.changeset(%{
        issue_id: issue.id,
        kind: "comment",
        body: "local note",
        author: "raphael"
      })
      |> Repo.insert()

    assert is_nil(comment.remote_id)
    assert :ok = LocalStore.link_comment_remote_id(comment.id, "IC_pushed")

    reloaded = Repo.get(SymphonyElixir.LocalTracker.Comment, comment.id)
    assert reloaded.remote_id == "IC_pushed"
    assert reloaded.sync_status == "synced"
  end

  test "link_comment_remote_id is a no-op for unknown ids or a nil remote id", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    {:ok, comment} =
      %SymphonyElixir.LocalTracker.Comment{}
      |> SymphonyElixir.LocalTracker.Comment.changeset(%{issue_id: issue.id, kind: "comment", body: "x", author: "raphael"})
      |> Repo.insert()

    assert :ok = LocalStore.link_comment_remote_id(nil, "ignored")
    assert :ok = LocalStore.link_comment_remote_id(999_999, "ignored")
    assert :ok = LocalStore.link_comment_remote_id(comment.id, nil)

    reloaded = Repo.get(SymphonyElixir.LocalTracker.Comment, comment.id)
    assert is_nil(reloaded.remote_id)
  end

  test "remote update overwrites fields with no pending local edit", %{project: project} do
    {:ok, _} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "v1"}))
    {:ok, updated} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "v2", remote_updated_at: DateTime.utc_now()}))
    assert updated.title == "v2"
    assert updated.sync_status == "synced"
  end

  test "preserves local labels when labels are marked dirty", %{project: project} do
    {:ok, issue} =
      LocalStore.upsert_remote_issue(
        project,
        remote_issue(%{labels: [%{name: "remote-only", remote_id: "LA_remote"}]})
      )

    assert {:ok, _} =
             Context.update_issue(project.slug, issue.identifier, %{"label_ids" => ["local-label"]})

    assert {:ok, _} = LocalStore.mark_dirty(issue.identifier, project.slug, [:labels])

    {:ok, after_pull} =
      LocalStore.upsert_remote_issue(
        project,
        remote_issue(%{labels: [%{name: "remote-only", remote_id: "LA_remote"}]})
      )

    loaded = Repo.get(IssueRecord, after_pull.id) |> Repo.preload(:labels)
    assert Enum.map(loaded.labels, & &1.name) == ["local-label"]
  end

  test "a newer pending local edit survives a remote pull", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{title: "remote-v1"}))

    future = DateTime.utc_now() |> DateTime.add(120, :second) |> DateTime.to_iso8601()

    Repo.get!(IssueRecord, issue.id)
    |> Ecto.Changeset.change(%{title: "local-edit", dirty_fields: %{"title" => future}})
    |> Repo.update!()

    {:ok, after_pull} =
      LocalStore.upsert_remote_issue(project, remote_issue(%{title: "remote-v2", remote_updated_at: DateTime.utc_now()}))

    assert after_pull.title == "local-edit"
    assert Map.has_key?(after_pull.dirty_fields, "title")
  end

  test "upsert_pull_requests links and updates PR state", %{project: project} do
    {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{}))

    :ok = LocalStore.upsert_pull_requests(issue, [%{remote_id: "PR_1", number: 9, url: "u", title: "t", state: "open"}])
    :ok = LocalStore.upsert_pull_requests(issue, [%{remote_id: "PR_1", number: 9, url: "u", title: "t", state: "merged"}])

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert length(prs) == 1
    assert hd(prs).state == "merged"
  end

  describe "upsert_run_pull_request/3" do
    test "links a PR with origin agent keyed by URL", %{project: project} do
      url = "https://github.com/o/r/pull/42"

      assert {:ok, record} =
               LocalStore.upsert_run_pull_request(project.id, "GAM-9", %{
                 url: url,
                 repo: "o/r",
                 number: 42,
                 title: "GAM-9: Do the thing",
                 state: "OPEN"
               })

      assert record.origin == "agent"
      assert record.remote_id == url

      # Idempotent on the same URL
      assert {:ok, again} = LocalStore.upsert_run_pull_request(project.id, "GAM-9", %{url: url, state: "OPEN"})
      assert again.id == record.id
    end
  end

  describe "write reduction (change-detection + batching)" do
    @fixed_dt ~U[2026-01-01 00:00:00.000000Z]

    test "an identical pull does not rewrite the issue row", %{project: project} do
      remote = remote_issue(%{remote_updated_at: @fixed_dt})
      {:ok, issue} = LocalStore.upsert_remote_issue(project, remote)
      stored = Repo.get(IssueRecord, issue.id)

      {:ok, _} = LocalStore.upsert_remote_issue(project, remote)
      reloaded = Repo.get(IssueRecord, issue.id)

      assert reloaded.updated_at == stored.updated_at
      assert reloaded.last_synced_at == stored.last_synced_at
    end

    test "a changed remote still rewrites the issue row", %{project: project} do
      {:ok, issue} = LocalStore.upsert_remote_issue(project, remote_issue(%{remote_updated_at: @fixed_dt}))
      stored = Repo.get(IssueRecord, issue.id)

      {:ok, _} =
        LocalStore.upsert_remote_issue(
          project,
          remote_issue(%{title: "Changed", remote_updated_at: DateTime.add(@fixed_dt, 60, :second)})
        )

      reloaded = Repo.get(IssueRecord, issue.id)
      assert reloaded.title == "Changed"
      assert reloaded.updated_at != stored.updated_at
    end

    test "an identical comment pull does not rewrite the comment", %{project: project} do
      comments = [
        %{remote_id: "IC_1", body: "hello", author: "octocat", kind: "comment", remote_updated_at: @fixed_dt}
      ]

      remote = remote_issue(%{remote_updated_at: @fixed_dt, comments: comments})
      {:ok, _issue} = LocalStore.upsert_remote_issue(project, remote)
      stored = Repo.one(SymphonyElixir.LocalTracker.Comment)

      {:ok, _} = LocalStore.upsert_remote_issue(project, remote)
      reloaded = Repo.get(SymphonyElixir.LocalTracker.Comment, stored.id)

      assert reloaded.updated_at == stored.updated_at
      assert reloaded.last_synced_at == stored.last_synced_at
    end

    test "re-pulling an identical label set keeps it without duplicating links", %{project: project} do
      labels = [%{remote_id: "LA_1", name: "bug", color: "ff0000"}]
      remote = remote_issue(%{remote_updated_at: @fixed_dt, labels: labels})

      {:ok, issue} = LocalStore.upsert_remote_issue(project, remote)
      {:ok, _} = LocalStore.upsert_remote_issue(project, remote)

      loaded = Repo.get(IssueRecord, issue.id) |> Repo.preload(:labels)
      assert Enum.map(loaded.labels, & &1.name) == ["bug"]
    end

    test "upsert_remote_issues upserts many issues in one transaction and is idempotent", %{project: project} do
      remotes = [
        remote_issue(%{remote_id: "I_1", identifier: "1", title: "One"}),
        remote_issue(%{remote_id: "I_2", identifier: "2", title: "Two"})
      ]

      assert {:ok, 2} = LocalStore.upsert_remote_issues(project, remotes)
      assert length(Repo.all(IssueRecord)) == 2

      assert {:ok, 2} = LocalStore.upsert_remote_issues(project, remotes)
      assert length(Repo.all(IssueRecord)) == 2
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
