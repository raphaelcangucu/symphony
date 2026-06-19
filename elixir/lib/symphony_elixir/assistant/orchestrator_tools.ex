defmodule SymphonyElixir.Assistant.OrchestratorTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.Presenter
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "get_issue_orchestrator_state"
  @orchestrator SymphonyElixir.Orchestrator
  @snapshot_timeout_ms 15_000

  @description """
  Report what the orchestrator is doing with an issue: persisted status plus any live running/retry entry.
  Use to answer "is this issue running, retrying, or idle right now?".
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    state_fun = Keyword.get(opts, :orchestrator_state, &default_state/1)

    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, issue} <- Context.get_issue(project_slug, identifier) do
      {active, payload} =
        case state_fun.(identifier) do
          {:ok, state} -> {true, state}
          {:error, _reason} -> {false, nil}
        end

      {:ok,
       %{
         tool: @tool,
         message: orchestrator_message(identifier, active),
         data: %{active: active, issue: TrackerPresenter.issue(issue), orchestrator: payload}
       }}
    end
  end

  defp default_state(identifier) do
    Presenter.issue_payload(identifier, @orchestrator, @snapshot_timeout_ms)
  rescue
    _error -> {:error, :issue_not_found}
  catch
    :exit, _reason -> {:error, :issue_not_found}
  end

  defp orchestrator_message(identifier, true), do: "#{identifier} is active in the orchestrator."
  defp orchestrator_message(identifier, false), do: "#{identifier} is not currently running or retrying."

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
