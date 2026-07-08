defmodule SymphonyElixir.GitHub.SourceControl do
  @moduledoc """
  Default `SymphonyElixir.SourceControl` implementation, delegating to the
  existing GitHub modules (`GitHub.Client` for PR-existence checks,
  `GitHub.PullRequests` for per-issue PR lookup).
  """

  @behaviour SymphonyElixir.SourceControl

  alias SymphonyElixir.GitHub.{Client, PullRequests}

  @impl true
  defdelegate issue_has_open_pull_request?(identifier), to: Client

  @impl true
  defdelegate supported?(project), to: PullRequests

  @impl true
  defdelegate available?, to: PullRequests

  @impl true
  defdelegate for_project_issue(project, identifier, opts), to: PullRequests
end
