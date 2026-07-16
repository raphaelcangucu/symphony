defmodule SymphonyElixir.Assistant.TunnelTools do
  @moduledoc false

  alias SymphonyElixir.Cloudflare.Tunnel

  @tool "manage_tunnel"

  @description "Inspect or start the Cloudflare public preview tunnel for this project. Prefer manage_preview for servers."

  # Project-assistant catalog: one schema only. The issue-bound variant (no
  # optional identifier) is advertised separately via
  # `DynamicTool.coding_agent_tool_specs/0` — listing both here duplicates the
  # name and makes Codex/Cursor reject the turn with
  # `duplicate dynamic tool name: manage_tunnel`.
  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(%{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{
        "action" => action_schema(),
        "identifier" => %{"type" => "string", "description" => "Optional issue id for context."}
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(%{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{"action" => action_schema()}
    })
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    summary = Keyword.get(opts, :summary, &Tunnel.summary_for_project/1)
    start_tunnel = Keyword.get(opts, :start_tunnel, &Tunnel.start_tunnel/0)

    with {:ok, action} <- normalize_action(Map.get(arguments, "action")) do
      execute_action(action, project_slug, summary, start_tunnel)
    end
  end

  defp execute_action(:status, project_slug, summary, _start_tunnel) do
    data = summary.(project_slug)

    {:ok,
     %{
       tool: @tool,
       message: "Tunnel status for #{project_slug}.",
       data: Map.merge(data, %{ok: true})
     }}
  end

  defp execute_action(:start, project_slug, summary, start_tunnel) do
    case start_tunnel.() do
      {:ok, _status} ->
        data = summary.(project_slug)

        {:ok,
         %{
           tool: @tool,
           message: "Started public preview tunnel.",
           data: Map.merge(data, %{ok: true})
         }}

      {:error, reason} ->
        data = summary.(project_slug)

        {:ok,
         %{
           tool: @tool,
           message: "Failed to start tunnel.",
           data:
             Map.merge(data, %{
               ok: false,
               reason: "tunnel_failed",
               detail: inspect(reason),
               next_steps: "Check cloudflared install and public_tunnel workflow settings, then retry manage_tunnel start."
             })
         }}
    end
  end

  defp execute_action(:stop, project_slug, summary, _start_tunnel) do
    data = summary.(project_slug)

    {:ok,
     %{
       tool: @tool,
       message: "Tunnel stop is not supported.",
       data:
         Map.merge(data, %{
           ok: false,
           reason: "unsupported",
           next_steps: "Tunnel stop is not available; leave the tunnel running or restart Symphony if needed. Use manage_tunnel start if it is stopped."
         })
     }}
  end

  defp action_schema do
    %{
      "type" => "string",
      "enum" => ["status", "start", "stop"],
      "description" => "Tunnel action. stop is unsupported today and returns reason unsupported."
    }
  end

  defp tool_spec(input_schema) do
    %{
      "name" => @tool,
      "description" => @description,
      "inputSchema" => input_schema
    }
  end

  defp normalize_action(action) when is_binary(action) do
    case String.trim(action) |> String.downcase() do
      "status" -> {:ok, :status}
      "start" -> {:ok, :start}
      "stop" -> {:ok, :stop}
      other -> {:error, {:invalid_tunnel_action, other}}
    end
  end

  defp normalize_action(action), do: {:error, {:invalid_tunnel_action, action}}
end
