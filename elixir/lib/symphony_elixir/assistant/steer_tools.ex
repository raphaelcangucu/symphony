defmodule SymphonyElixir.Assistant.SteerTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "steer_agent"

  @description """
  Inject a steering message into a running coding agent's current turn; the agent reads it mid-run.
  Use to add context, correct course, or answer a question without restarting the agent.
  The issue must have an active, steerable turn (check list_running_agents first).
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "message"],
        "properties" => %{
          "identifier" => %{
            "type" => "string",
            "description" => "Identifier of the running issue/agent, for example MAC-1."
          },
          "message" => %{
            "type" => "string",
            "description" => "Instruction or context to inject into the running turn."
          }
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    steer_fun = Keyword.get(opts, :steer, &Orchestrator.steer/3)

    with {:ok, identifier} <- required(arguments, "identifier", :missing_identifier),
         {:ok, message} <- required(arguments, "message", :missing_message),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         :ok <- deliver(steer_fun, identifier, message) do
      {:ok,
       %{
         tool: @tool,
         message: "Delivered steering message to #{identifier}.",
         data: %{issue: TrackerPresenter.issue(issue), delivered: true, steer_message: message}
       }}
    end
  end

  defp deliver(steer_fun, identifier, message) do
    case steer_fun.(identifier, message, nil) do
      :ok -> :ok
      {:error, :ActiveTurnNotSteerable} -> {:error, :agent_not_running}
      {:error, :empty_message} -> {:error, :missing_message}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:unexpected_steer_result, other}}
    end
  end

  defp required(arguments, key, error) do
    case Map.get(arguments, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, error}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, error}
    end
  end
end
