defmodule SymphonyElixir.PullRequestMonitor.MonitorStateTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PullRequestMonitor.MonitorState
  alias SymphonyElixir.Repo

  @key %{project_slug: "proj", identifier: "#42", pr_url: "https://github.com/o/r/pull/7"}

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  test "get/3 returns nil when missing, upsert/4 creates then updates" do
    assert MonitorState.get(@key.project_slug, @key.identifier, @key.pr_url) == nil

    assert {:ok, row} =
             MonitorState.upsert(@key.project_slug, @key.identifier, @key.pr_url, %{
               last_head_sha: "abc",
               last_checks_fingerprint: "fp1"
             })

    assert row.auto_rework_count == 0

    assert {:ok, updated} =
             MonitorState.upsert(@key.project_slug, @key.identifier, @key.pr_url, %{
               last_checks_fingerprint: "fp2",
               auto_rework_count: 1
             })

    assert updated.id == row.id
    assert updated.last_checks_fingerprint == "fp2"
    assert MonitorState.max_rework_count(@key.project_slug, @key.identifier) == 1
  end

  test "max_rework_count/2 is 0 with no rows and max across PRs" do
    assert MonitorState.max_rework_count("proj", "#42") == 0

    {:ok, _} = MonitorState.upsert("proj", "#42", "url-a", %{auto_rework_count: 1})
    {:ok, _} = MonitorState.upsert("proj", "#42", "url-b", %{auto_rework_count: 2})

    assert MonitorState.max_rework_count("proj", "#42") == 2
  end

  test "attach/3 merges monitor info into PR maps by url" do
    {:ok, _} =
      MonitorState.upsert("proj", "#42", "url-a", %{
        last_action: "moved_to_rework",
        last_classification: %{"summary" => "test failed in changed file"},
        auto_rework_count: 1,
        last_action_at: DateTime.utc_now()
      })

    [with_monitor, without] =
      MonitorState.attach([%{url: "url-a"}, %{url: "url-b"}], "proj", "#42")

    assert with_monitor.monitor.last_action == "moved_to_rework"
    assert with_monitor.monitor.summary == "test failed in changed file"
    assert with_monitor.monitor.auto_rework_count == 1
    assert without.monitor == nil
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
