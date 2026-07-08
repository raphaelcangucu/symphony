defmodule SymphonyElixir.Config.Tracker do
  @moduledoc """
  Tracker detection and board-state configuration derived from WORKFLOW.md:
  which tracker kind is configured, the active/terminal/field/dispatch/wait
  state lists, and the tracker config module used for validation.
  `SymphonyElixir.Config` delegates here.
  """

  alias SymphonyElixir.Config.Workflow

  @tracker_sections ["local", "linear", "jira", "github", "memory"]

  @spec tracker_kind() :: String.t()
  def tracker_kind do
    case Workflow.detect_sections(@tracker_sections) do
      [] -> "github"
      [kind | _] -> kind
    end
  end

  @spec tracker_sync_enabled?() :: boolean()
  def tracker_sync_enabled? do
    :symphony_elixir
    |> Application.get_env(:tracker, [])
    |> fetch_sync_enabled()
    |> truthy?()
  end

  @spec active_states() :: [String.t()]
  def active_states do
    get_in(Workflow.validated_options(), [:tracker, :active_states])
  end

  @spec terminal_states() :: [String.t()]
  def terminal_states do
    get_in(Workflow.validated_options(), [:tracker, :terminal_states])
  end

  @doc """
  All states provisioned on the GitHub Project `Status` field.

  Defaults to `active_states` plus `terminal_states` (unique, order preserved).
  Use `field_states` in WORKFLOW when the board needs options such as `Backlog`
  that are not polled or dispatched.
  """
  @spec field_states() :: [String.t()]
  def field_states do
    case field_states_from_workflow() do
      [] -> (active_states() ++ terminal_states()) |> Enum.uniq()
      states -> states
    end
  end

  @doc """
  Workflow statuses derived from the configured board states, ordered to match
  `field_states/0`. Each entry is `{name, category, is_terminal}` where the
  category is inferred from the `terminal_states`/`wait_states`/`active_states`
  lists. Used to seed a project's status set locally so the tracker stays
  local-first when a remote board cannot be reached.
  """
  @spec workflow_statuses() :: [{String.t(), String.t(), boolean()}]
  def workflow_statuses do
    terminal = MapSet.new(terminal_states())
    wait = MapSet.new(wait_states())
    active = MapSet.new(active_states())

    Enum.map(field_states(), fn name ->
      cond do
        MapSet.member?(terminal, name) -> {name, "terminal", true}
        MapSet.member?(wait, name) -> {name, "wait", false}
        MapSet.member?(active, name) -> {name, "active", false}
        true -> {name, "backlog", false}
      end
    end)
  end

  @doc """
  States that may start a new agent run. Defaults to `active_states/0`.
  """
  @spec dispatch_states() :: [String.t()]
  def dispatch_states do
    case get_in(Workflow.validated_options(), [:tracker, :dispatch_states]) do
      states when is_list(states) and states != [] ->
        states |> Enum.map(&to_string/1) |> Enum.uniq()

      _ ->
        active_states()
    end
  end

  @doc """
  Active states where an existing run should stop after the current turn (e.g. Human Review).
  """
  @spec wait_states() :: [String.t()]
  def wait_states do
    get_in(Workflow.validated_options(), [:tracker, :wait_states])
    |> case do
      states when is_list(states) -> states |> Enum.map(&to_string/1) |> Enum.uniq()
      _ -> []
    end
  end

  @doc "Config module for the configured tracker kind (used for `validate!`)."
  @spec config_module() :: module()
  def config_module do
    case tracker_kind() do
      "local" -> SymphonyElixir.LocalTracker.Config
      "linear" -> SymphonyElixir.Linear.Config
      "jira" -> SymphonyElixir.Jira.Config
      "github" -> SymphonyElixir.GitHub.Config
      "memory" -> SymphonyElixir.Memory.Config
    end
  end

  defp fetch_sync_enabled(config) when is_list(config), do: Keyword.get(config, :sync_enabled, false)
  defp fetch_sync_enabled(%{} = config), do: Map.get(config, :sync_enabled, false)
  defp fetch_sync_enabled(_config), do: false

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?("1"), do: true
  defp truthy?(_other), do: false

  defp field_states_from_workflow do
    Workflow.validated_options()
    |> get_in([:tracker, :field_states])
    |> case do
      states when is_list(states) -> states |> Enum.map(&to_string/1) |> Enum.uniq()
      _ -> []
    end
  end
end
