defmodule SymphonyElixir.Tracker.Sync.PullRequestRecordTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  test "accepts project_id, issue_identifier, repo, origin and the unknown state" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        project_id: 1,
        issue_identifier: "510",
        remote_id: "https://github.com/clouapp/back/pull/277",
        number: 277,
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        origin: "manual",
        state: "unknown"
      })

    assert cs.valid?
  end

  test "requires project_id and issue_identifier" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        remote_id: "x",
        state: "open"
      })

    refute cs.valid?
    assert %{project_id: _, issue_identifier: _} = errors_on(cs)
  end

  test "rejects an unknown origin value" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        project_id: 1,
        issue_identifier: "510",
        remote_id: "x",
        state: "open",
        origin: "bogus"
      })

    refute cs.valid?
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
