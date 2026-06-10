defmodule SymphonyElixir.Tracker do
  @moduledoc """
  Adapter boundary for issue tracker reads and writes.
  """

  alias SymphonyElixir.Config

  @callback project_identity() :: String.t() | nil
  @callback default_prompt_template() :: String.t()
  @callback fetch_candidate_issues() :: {:ok, [term()]} | {:error, term()}
  @callback fetch_issues_by_states([String.t()]) :: {:ok, [term()]} | {:error, term()}
  @callback fetch_issue_states_by_ids([String.t()]) :: {:ok, [term()]} | {:error, term()}
  @callback create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  @callback upsert_workpad(String.t(), String.t()) :: :ok | {:error, term()}
  @callback update_issue_state(String.t(), String.t()) :: :ok | {:error, term()}

  @spec project_identity() :: String.t() | nil
  def project_identity, do: adapter().project_identity()

  @spec default_prompt_template() :: String.t()
  def default_prompt_template, do: adapter().default_prompt_template()

  @spec fetch_candidate_issues() :: {:ok, [term()]} | {:error, term()}
  def fetch_candidate_issues do
    adapter().fetch_candidate_issues()
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [term()]} | {:error, term()}
  def fetch_issues_by_states(states) do
    adapter().fetch_issues_by_states(states)
  end

  @spec fetch_issue_states_by_ids([String.t()]) :: {:ok, [term()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids) do
    adapter().fetch_issue_states_by_ids(issue_ids)
  end

  @doc """
  Lazily enriches a single issue with extra context (e.g. PR discussion) right before
  dispatch. Adapters that do not implement enrichment return the issue unchanged.
  """
  @spec enrich_issue(term()) :: term()
  def enrich_issue(issue) do
    adapter = adapter()

    if function_exported?(adapter, :enrich_issue, 1) do
      apply(adapter, :enrich_issue, [issue])
    else
      issue
    end
  end

  @spec create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  def create_comment(issue_id, body) do
    adapter().create_comment(issue_id, body)
  end

  @doc """
  Creates the issue's `## Codex Workpad` comment, or edits the existing one in
  place. One workpad per issue; edits flow to the remote tracker as
  `comment:update` outbox operations. Adapters without upsert support fall back
  to plain comment creation.
  """
  @spec upsert_workpad(String.t(), String.t()) :: :ok | {:error, term()}
  def upsert_workpad(issue_id, body) do
    adapter().upsert_workpad(issue_id, body)
  end

  @spec update_issue_state(String.t(), String.t()) :: :ok | {:error, term()}
  def update_issue_state(issue_id, state_name) do
    adapter().update_issue_state(issue_id, state_name)
  end

  @spec adapter() :: module()
  def adapter do
    if Config.tracker_sync_enabled?() do
      SymphonyElixir.Tracker.Sync.LocalFirstTracker
    else
      remote_adapter(Config.tracker_kind())
    end
  end

  defp remote_adapter("local"), do: SymphonyElixir.LocalTracker.Tracker
  defp remote_adapter("memory"), do: SymphonyElixir.Memory.Tracker
  defp remote_adapter("linear"), do: SymphonyElixir.Linear.Tracker
  defp remote_adapter("jira"), do: SymphonyElixir.Jira.Tracker
  defp remote_adapter(_kind), do: SymphonyElixir.GitHub.Tracker
end
