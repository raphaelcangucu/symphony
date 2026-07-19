defmodule SymphonyElixir.Tracker.Sync.Driver do
  @moduledoc """
  Contract every remote tracker (GitHub, Linear, …) implements for the sync
  engine. The engine is the only caller; drivers must not touch the local store.

  - `pull/2` returns normalized issue maps (see `Tracker.Sync.LocalStore`) for the
    project, optionally constrained by `:since` (incremental cursor) in `opts`.
  - `push/2` applies one outbox entry to the remote and returns the remote id it
    created/affected (or `nil`). It must be idempotent enough to tolerate retries.
  - `pull_pull_requests/2` returns PR maps linked to one issue. GitHub implements
    it for every project (GitHub is the standard source control); other drivers
    may return `{:ok, []}`.
  """

  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}
  alias SymphonyElixir.Tracker.Sync.OutboxEntry

  @type normalized_issue :: map()
  @type pr :: map()

  @callback pull(Project.t(), keyword()) :: {:ok, [normalized_issue()]} | {:error, term()}
  @callback push(Project.t(), OutboxEntry.t()) :: {:ok, String.t() | nil | map()} | {:error, term()}
  @callback pull_pull_requests(Project.t(), IssueRecord.t()) :: {:ok, [pr()]} | {:error, term()}
end
