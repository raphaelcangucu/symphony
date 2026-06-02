defmodule SymphonyElixir.Tracker.Sync.PullRequestRecordTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.PullRequestRecord

  test "accepts repo, origin and the unknown state" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        issue_id: 1,
        remote_id: "https://github.com/clouapp/back/pull/277",
        number: 277,
        url: "https://github.com/clouapp/back/pull/277",
        repo: "clouapp/back",
        origin: "manual",
        state: "unknown"
      })

    assert cs.valid?
  end

  test "rejects an unknown origin value" do
    cs =
      PullRequestRecord.changeset(%PullRequestRecord{}, %{
        issue_id: 1,
        remote_id: "x",
        state: "open",
        origin: "bogus"
      })

    refute cs.valid?
  end
end
