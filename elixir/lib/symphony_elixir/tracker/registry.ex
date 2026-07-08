defmodule SymphonyElixir.Tracker.Registry do
  @moduledoc """
  Single source of truth mapping a tracker kind to its implementation modules.

  Consolidates the kind -> module dispatch previously duplicated across
  `SymphonyElixir.Tracker`, `SymphonyElixir.Tracker.IssueAdapter`,
  `SymphonyElixir.Tracker.Sync.Engine` and
  `SymphonyElixir.Tracker.Sync.LocalFirstTracker`.
  """

  @type kind :: String.t()
  @type entry :: %{
          tracker: module(),
          issue_adapter: module() | nil,
          sync_driver: module() | nil
        }

  @entries %{
    "local" => %{
      tracker: SymphonyElixir.LocalTracker.Tracker,
      issue_adapter: SymphonyElixir.LocalTracker.IssueAdapter,
      sync_driver: nil
    },
    "memory" => %{
      tracker: SymphonyElixir.Memory.Tracker,
      issue_adapter: nil,
      sync_driver: nil
    },
    "github" => %{
      tracker: SymphonyElixir.GitHub.Tracker,
      issue_adapter: SymphonyElixir.GitHub.IssueAdapter,
      sync_driver: SymphonyElixir.GitHub.SyncDriver
    },
    "linear" => %{
      tracker: SymphonyElixir.Linear.Tracker,
      issue_adapter: SymphonyElixir.Linear.IssueAdapter,
      sync_driver: SymphonyElixir.Linear.SyncDriver
    },
    "jira" => %{
      tracker: SymphonyElixir.Jira.Tracker,
      issue_adapter: SymphonyElixir.Jira.IssueAdapter,
      sync_driver: SymphonyElixir.Jira.SyncDriver
    }
  }

  @remote_kinds ["github", "linear", "jira"]

  @doc "Kinds backed by a remote tracker (the only kinds with sync drivers)."
  @spec remote_kinds() :: [kind()]
  def remote_kinds, do: @remote_kinds

  @spec entry(kind()) :: entry() | nil
  def entry(kind), do: Map.get(@entries, kind)

  @doc """
  Orchestrator tracker module for a kind. Unknown kinds fall back to GitHub,
  preserving the historical default of `SymphonyElixir.Tracker.adapter/0`.
  """
  @spec tracker(kind()) :: module()
  def tracker(kind) do
    case entry(kind) do
      %{tracker: tracker} -> tracker
      nil -> SymphonyElixir.GitHub.Tracker
    end
  end

  @doc "Default `Tracker.IssueAdapter` implementations keyed by kind."
  @spec issue_adapters() :: %{kind() => module()}
  def issue_adapters do
    for {kind, %{issue_adapter: adapter}} <- @entries, not is_nil(adapter), into: %{} do
      {kind, adapter}
    end
  end

  @doc "Sync driver module for a kind, or `nil` when the kind has none."
  @spec sync_driver(kind()) :: module() | nil
  def sync_driver(kind) do
    case entry(kind) do
      %{sync_driver: driver} -> driver
      nil -> nil
    end
  end
end
