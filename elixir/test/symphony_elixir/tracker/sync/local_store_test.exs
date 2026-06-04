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

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
