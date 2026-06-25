defmodule SymphonyElixir.Assistant.RunningAgentsTools do
  @moduledoc false

  alias SymphonyElixirWeb.Presenter

  @tool "list_running_agents"
  @orchestrator SymphonyElixir.Orchestrator
  @snapshot_timeout_ms 15_000

  @description """
  List the coding agents the orchestrator is running or retrying right now (live, in-memory state).
  Use to answer "which agents are executing?" before steering one with steer_agent.
  Scoped to the current project; the CLI can omit the slug to see every project.
  """

  @spec tool_name() :: String.t()
  def tool_name, do: @tool

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t() | nil, map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts)
      when (is_nil(project_slug) or is_binary(project_slug)) and is_map(arguments) do
    state_fun = Keyword.get(opts, :state_payload, &default_state_payload/1)

    {available, running, retrying} = extract(state_fun.(project_slug))

    {:ok,
     %{
       tool: @tool,
       message: message(available, running, retrying, project_slug),
       data: %{
         project_slug: project_slug,
         available: available,
         counts: %{running: length(running), retrying: length(retrying)},
         running: running,
         retrying: retrying
       }
     }}
  end

  defp default_state_payload(project_slug) do
    Presenter.state_payload(@orchestrator, @snapshot_timeout_ms, project_slug)
  end

  defp extract(%{error: _error}), do: {false, [], []}

  defp extract(%{} = payload),
    do: {true, Map.get(payload, :running, []), Map.get(payload, :retrying, [])}

  defp extract(_payload), do: {false, [], []}

  defp message(false, _running, _retrying, _scope),
    do: "Orchestrator snapshot unavailable; cannot list running agents right now."

  defp message(true, [], [], scope),
    do: "No agents are currently running#{scope_suffix(scope)}."

  defp message(true, running, retrying, scope) do
    "#{length(running)} agent(s) running, #{length(retrying)} retrying#{scope_suffix(scope)}."
  end

  defp scope_suffix(nil), do: " across all projects"
  defp scope_suffix(slug) when is_binary(slug), do: " in #{slug}"
end
