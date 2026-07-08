defmodule SymphonyElixir.Tracker.RemoteError do
  @moduledoc """
  Shared HTTP-status error mapping for remote tracker issue adapters.

  Each adapter tags raw HTTP failures with a provider-specific status tuple
  (`{:github_api_status, status}`, `{:linear_api_status, status}`,
  `{:jira_api_status, status}`). The clauses common to every provider live
  here; adapters keep their provider-specific clauses and delegate the rest
  via `normalize/2`.
  """

  alias SymphonyElixir.Tracker.IssueAdapter

  @doc """
  Maps the error shapes shared by all remote adapters:

    * `{:error, reason}` wrappers are unwrapped
    * `{:remote_validation, details}` passes through unchanged
    * `{status_tag, 401}` -> `:remote_unauthorized`
    * `{status_tag, 403}` -> `:remote_forbidden`
    * `{status_tag, 500..599}` -> `:remote_unavailable`
    * anything else -> `:remote_unavailable` (historical catch-all)
  """
  @spec normalize(term(), atom()) :: IssueAdapter.tracker_error()
  def normalize({:error, reason}, status_tag), do: normalize(reason, status_tag)
  def normalize({:remote_validation, _details} = error, _status_tag), do: error
  def normalize({status_tag, 401}, status_tag), do: :remote_unauthorized
  def normalize({status_tag, 403}, status_tag), do: :remote_forbidden

  def normalize({status_tag, status}, status_tag) when status in 500..599,
    do: :remote_unavailable

  def normalize(_reason, _status_tag), do: :remote_unavailable
end
