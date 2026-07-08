defmodule SymphonyElixir.SourceControl do
  @moduledoc """
  Behaviour + facade for the source-control (PR/branch) operations the
  orchestration layer needs outside of `github/`. GitHub is Symphony's
  standard source control today; this seam keeps the callers
  (`AgentRunner`, `Assistant.PullRequestLookup`) provider-agnostic and lets
  tests or a future provider swap the implementation via app env:

      config :symphony_elixir, :source_control_impl, MyProvider.SourceControl

  Scoped narrowly on purpose: only the operations those call sites use are
  part of the contract. GitHub-specific modules (controllers, sync driver,
  client plumbing) keep calling `GitHub.*` directly.
  """

  alias SymphonyElixir.LocalTracker.Project

  @typedoc "Pull request summary map (`:number`, `:url`, `:title`, `:state`, ...)."
  @type pull_request :: map()

  @doc "Whether the issue has at least one open pull request linked to it."
  @callback issue_has_open_pull_request?(integer() | String.t()) ::
              {:ok, boolean()} | {:error, term()}

  @doc "Whether PR lookup is configured for the project (e.g. repos are known)."
  @callback supported?(Project.t()) :: boolean()

  @doc "Whether the provider is usable right now (e.g. a token is configured)."
  @callback available?() :: boolean()

  @doc "Lists pull requests linked to one project issue."
  @callback for_project_issue(Project.t(), String.t(), keyword()) :: {:ok, [pull_request()]}

  @spec issue_has_open_pull_request?(integer() | String.t()) :: {:ok, boolean()} | {:error, term()}
  def issue_has_open_pull_request?(identifier), do: impl().issue_has_open_pull_request?(identifier)

  @spec supported?(Project.t()) :: boolean()
  def supported?(%Project{} = project), do: impl().supported?(project)

  @spec available?() :: boolean()
  def available?, do: impl().available?()

  @spec for_project_issue(Project.t(), String.t(), keyword()) :: {:ok, [pull_request()]}
  def for_project_issue(%Project{} = project, identifier, opts \\ []),
    do: impl().for_project_issue(project, identifier, opts)

  defp impl do
    Application.get_env(:symphony_elixir, :source_control_impl, SymphonyElixir.GitHub.SourceControl)
  end
end
