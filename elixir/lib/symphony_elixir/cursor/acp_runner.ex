defmodule SymphonyElixir.Cursor.AcpRunner do
  @moduledoc """
  Runs one interactive Cursor turn over `agent acp` (JSON-RPC NDJSON).

  Non-interactive / orchestrator turns keep using `CliRunner` (`--print`).
  """

  require Logger

  alias SymphonyElixir.Assistant.UserInputBroker
  alias SymphonyElixir.Claude.ApprovalBroker
  alias SymphonyElixir.Cursor.AcpBridge
  alias SymphonyElixir.Cursor.AcpClient
  alias SymphonyElixir.Cursor.CreatePlanBroker

  @default_timeout_ms 300_000
  @approval_timeout_ms 300_000

  @type turn_args :: %{
          required(:command) => String.t(),
          required(:workspace) => Path.t(),
          required(:prompt) => String.t(),
          required(:session_uuid) => String.t(),
          required(:cli_session_id) => String.t() | nil,
          required(:model) => String.t() | nil,
          required(:mcp_config_path) => Path.t() | nil,
          required(:timeout_ms) => pos_integer(),
          optional(:execution_mode) => String.t() | nil,
          optional(:on_approval_required) => (map() -> any()),
          optional(:on_user_input_required) => (map() -> any()),
          optional(:on_create_plan_required) => (map() -> any())
        }

  @type turn_result :: %{
          cli_session_id: String.t() | nil,
          status: :completed,
          usage: map() | nil,
          cost_usd: number() | nil
        }

  @spec run_turn(turn_args(), (map() -> any())) :: {:ok, turn_result()} | {:error, term()}
  def run_turn(args, on_event) when is_map(args) and is_function(on_event, 1) do
    workspace = Path.expand(args.workspace)
    timeout_ms = Map.get(args, :timeout_ms, @default_timeout_ms)
    parent = self()

    on_server_request = fn method, id, params ->
      Task.start(fn ->
        handle_server_request(method, id, params, args, on_event, parent)
      end)

      :ok
    end

    {:ok, client} =
      case Map.get(args, :acp_client) do
        pid when is_pid(pid) ->
          {:ok, pid}

        _ ->
          client_opts =
            [
              workspace: workspace,
              on_server_request: on_server_request,
              model: Map.get(args, :model),
              agent_env: Map.get(args, :agent_env, %{})
            ] ++
              if Map.has_key?(args, :writer) do
                [writer: Map.fetch!(args, :writer)]
              else
                [command: args.command]
              end

          AcpClient.start_link(client_opts)
      end

    if is_function(Map.get(args, :on_client), 1) do
      args.on_client.(client)
    end

    try do
      with {:ok, _} <- initialize(client),
           {:ok, _} <- authenticate(client),
           {:ok, session} <- open_session(client, args, workspace),
           {:ok, prompt_result} <- prompt_and_drain(client, session.id, args.prompt, timeout_ms) do
        on_event.(%{
          "method" => "turn/completed",
          "params" => %{
            "session_id" => session.id,
            "stopReason" => Map.get(prompt_result, "stopReason")
          }
        })

        {:ok,
         %{
           cli_session_id: session.id,
           status: :completed,
           usage: nil,
           cost_usd: nil,
           provider_model: session.provider_model
         }}
      else
        {:error, reason} = err ->
          on_event.(%{"method" => "turn/failed", "params" => %{"reason" => inspect(reason)}})
          err
      end
    after
      if Process.alive?(client), do: GenServer.stop(client, :normal, 5_000)
    end
  end

  defp handle_server_request(method, id, params, args, on_event, parent) do
    callbacks = %{
      on_event: on_event,
      on_approval_required: fn request ->
        await_permission(request, args, parent)
      end,
      on_user_input_required: fn request ->
        await_questions(request, args, parent)
      end,
      on_create_plan_required: fn request ->
        await_create_plan(request, args, parent)
      end,
      respond: fn resp_id, result ->
        send(parent, {:acp_respond, resp_id, result})
        :ok
      end
    }

    AcpBridge.handle_server_message(
      %{"method" => method, "id" => id, "params" => params || %{}},
      callbacks
    )
  end

  defp await_permission(request, args, _parent) do
    request_id = Map.fetch!(request, :request_id)
    on_approval = Map.get(args, :on_approval_required)

    # Register the waiter before notifying UI so fast auto-approve (yolo) cannot
    # resolve into an empty registry.
    waiter = Task.async(fn -> ApprovalBroker.await(request_id, @approval_timeout_ms) end)
    Process.sleep(5)

    if is_function(on_approval, 1) do
      on_approval.(Map.drop(request, [:respond, :acp_id]))
    end

    decision = Task.await(waiter, @approval_timeout_ms + 1_000)
    request.respond.(if(decision == :approve, do: :approve, else: :deny))
    :ok
  end

  defp await_questions(request, args, _parent) do
    request_id = to_string(Map.fetch!(request, :request_id))
    questions = Map.get(request, :questions) || []
    on_user_input = Map.get(args, :on_user_input_required)

    UserInputBroker.ensure_started()
    waiter = Task.async(fn -> UserInputBroker.await(request_id, @approval_timeout_ms) end)
    Process.sleep(5)

    if is_function(on_user_input, 1) do
      on_user_input.(%{request_id: request_id, questions: questions})
    end

    answers =
      case Task.await(waiter, @approval_timeout_ms + 1_000) do
        {:ok, normalized} -> flatten_answers(normalized)
        {:error, _} -> %{}
      end

    request.respond.(answers)
    :ok
  end

  defp await_create_plan(request, args, _parent) do
    request_id = Map.fetch!(request, :request_id)
    on_create_plan = Map.get(args, :on_create_plan_required)

    CreatePlanBroker.ensure_started()
    waiter = Task.async(fn -> CreatePlanBroker.await(request_id, @approval_timeout_ms) end)
    Process.sleep(5)

    if is_function(on_create_plan, 1) do
      on_create_plan.(Map.drop(request, [:respond, :acp_id]))
    end

    decision = Task.await(waiter, @approval_timeout_ms + 1_000)
    request.respond.(decision)
    :ok
  end

  defp initialize(client) do
    AcpClient.request(client, "initialize", %{
      "protocolVersion" => 1,
      "clientCapabilities" => %{
        "fs" => %{"readTextFile" => false, "writeTextFile" => false},
        "terminal" => false
      },
      "clientInfo" => %{"name" => "symphony", "version" => "1.0.0"}
    })
  end

  defp authenticate(client) do
    AcpClient.request(client, "authenticate", %{"methodId" => "cursor_login"})
  end

  defp open_session(client, args, workspace) do
    mcp_servers = []

    case Map.get(args, :cli_session_id) do
      id when is_binary(id) and id != "" ->
        case AcpClient.request(client, "session/load", %{
               "sessionId" => id,
               "cwd" => workspace,
               "mcpServers" => mcp_servers
             }) do
          {:ok, result} ->
            session_identity(result, id)

          {:error, _} ->
            new_session(client, workspace, mcp_servers, args)
        end

      _ ->
        new_session(client, workspace, mcp_servers, args)
    end
  end

  defp new_session(client, workspace, mcp_servers, args) do
    params = %{
      "cwd" => workspace,
      "mcpServers" => mcp_servers
    }

    params =
      case Map.get(args, :execution_mode) do
        "plan" -> Map.put(params, "mode", "plan")
        _ -> params
      end

    case AcpClient.request(client, "session/new", params) do
      {:ok, %{"sessionId" => session_id} = result} when is_binary(session_id) ->
        session_identity(result, session_id)

      {:ok, other} ->
        {:error, {:session_new_invalid, other}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp session_identity(result, fallback_id) when is_map(result) and is_binary(fallback_id) do
    session_id = Map.get(result, "sessionId") || fallback_id
    provider_model = get_in(result, ["models", "currentModelId"])

    {:ok, %{id: session_id, provider_model: normalize_model(provider_model)}}
  end

  defp normalize_model(model) when is_binary(model) do
    case String.trim(model) do
      "" -> nil
      value -> value
    end
  end

  defp normalize_model(_model), do: nil

  defp prompt_and_drain(client, session_id, prompt, timeout_ms) do
    task =
      Task.async(fn ->
        AcpClient.request(
          client,
          "session/prompt",
          %{
            "sessionId" => session_id,
            "prompt" => [%{"type" => "text", "text" => prompt}]
          },
          timeout_ms
        )
      end)

    await_prompt_task(client, task, System.monotonic_time(:millisecond) + timeout_ms)
  end

  defp await_prompt_task(client, task, deadline_ms) do
    now = System.monotonic_time(:millisecond)

    if now > deadline_ms do
      Task.shutdown(task, :brutal_kill)
      {:error, :turn_timeout}
    else
      receive do
        {:acp_respond, id, result} when not is_nil(id) ->
          AcpClient.respond(client, id, result)
          await_prompt_task(client, task, deadline_ms)
      after
        50 ->
          case Task.yield(task, 0) do
            {:ok, result} ->
              drain_acp_responses(client)
              result

            nil ->
              await_prompt_task(client, task, deadline_ms)

            {:exit, reason} ->
              {:error, {:prompt_task_exit, reason}}
          end
      end
    end
  end

  defp drain_acp_responses(client) do
    receive do
      {:acp_respond, id, result} when not is_nil(id) ->
        AcpClient.respond(client, id, result)
        drain_acp_responses(client)
    after
      0 -> :ok
    end
  end

  defp flatten_answers(normalized) when is_map(normalized) do
    Map.new(normalized, fn {qid, value} ->
      answers =
        cond do
          is_map(value) -> Map.get(value, "answers") || Map.get(value, :answers) || []
          is_list(value) -> value
          is_binary(value) -> [value]
          true -> []
        end

      {to_string(qid), answers}
    end)
  end

  defp flatten_answers(_), do: %{}
end
