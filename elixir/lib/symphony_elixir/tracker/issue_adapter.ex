defmodule SymphonyElixir.Tracker.IssueAdapter do
  @moduledoc """
  Per-project read/write boundary for the tracker JSON API.

  Selected from the `Project` row, not from global config. The orchestrator's
  `SymphonyElixir.Tracker` behaviour is separate and unaffected.
  """

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  @type filters :: keyword()
  @type tracker_error ::
          :project_not_found
          | :issue_not_found
          | :status_not_found
          | :remote_unavailable
          | :remote_unauthorized
          | :remote_forbidden
          | :remote_rate_limited
          | :missing_credentials
          | :not_supported_on_remote
          | {:remote_validation, map()}
          | {:adapter_error, term()}

  @type label_option :: %{
          required(:id) => String.t() | nil,
          required(:name) => String.t(),
          optional(:color) => String.t() | nil
        }

  @type user_option :: %{
          required(:id) => String.t() | nil,
          required(:login) => String.t() | nil,
          optional(:name) => String.t() | nil,
          optional(:avatar_url) => String.t() | nil
        }

  @callback kind() :: :local | :github | :linear
  @callback list_issues(Project.t(), filters()) :: {:ok, [IssueDTO.t()]} | {:error, tracker_error()}
  @callback get_issue(Project.t(), String.t()) :: {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback create_issue(Project.t(), map()) :: {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback update_issue(Project.t(), String.t(), map()) ::
              {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback move_issue(Project.t(), String.t(), map()) ::
              {:ok, IssueDTO.t()} | {:error, tracker_error()}
  @callback list_statuses(Project.t()) :: {:ok, [IssueDTO.status()]} | {:error, tracker_error()}
  @callback list_labels(Project.t()) :: {:ok, [label_option()]} | {:error, tracker_error()}
  @callback list_assignable_users(Project.t()) :: {:ok, [user_option()]} | {:error, tracker_error()}
  @callback list_comments(Project.t(), String.t()) :: {:ok, [map()]} | {:error, tracker_error()}
  @callback add_comment(Project.t(), String.t(), String.t(), map()) ::
              {:ok, map()} | {:error, tracker_error()}

  @default_adapters %{
    "local" => SymphonyElixir.LocalTracker.IssueAdapter,
    "github" => SymphonyElixir.GitHub.IssueAdapter,
    "linear" => SymphonyElixir.Linear.IssueAdapter
  }

  @spec for(Project.t()) :: module()
  def for(%Project{tracker_kind: kind}) do
    overrides = Application.get_env(:symphony_elixir, :issue_adapters, %{})
    merged = Map.merge(@default_adapters, overrides)
    Map.get(merged, kind, SymphonyElixir.LocalTracker.IssueAdapter)
  end

  @spec dispatch(Project.t(), atom(), list()) :: term()
  def dispatch(%Project{} = project, fun, args) when is_atom(fun) and is_list(args) do
    adapter = __MODULE__.for(project)
    apply(adapter, fun, [project | args])
  end
end
