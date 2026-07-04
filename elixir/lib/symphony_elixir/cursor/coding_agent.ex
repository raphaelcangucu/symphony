defmodule SymphonyElixir.Cursor.CodingAgent do
  @moduledoc """
  Native Cursor Agent backend implementing the CodingAgent behaviour by
  spawning the `cursor-agent` CLI per turn (no external bridge). Tools are
  served through the shared MCP ToolGateway; events are translated by
  `SymphonyElixir.Cursor.CliRunner` into the bridge vocabulary the rest of
  Symphony understands.

  Unlike Claude (`--mcp-config <path>`), the cursor-agent CLI only reads MCP
  servers from `<workspace>/.cursor/mcp.json`, so the gateway entry is merged
  into that file at session start and removed at session stop.
  """

  @behaviour SymphonyElixir.CodingAgent

  require Logger

  alias SymphonyElixir.Claude.AppServer.ToolGateway
  alias SymphonyElixir.Config
  alias SymphonyElixir.Cursor.CliRunner

  @mcp_server_name "symphony"

  @type session :: %{
          session_uuid: String.t(),
          workspace: Path.t(),
          command: String.t(),
          cli_session_id: String.t() | nil,
          model: String.t() | nil,
          gateway_token: String.t() | nil,
          mcp_config_path: Path.t() | nil,
          mcp_config_backup: String.t() | nil,
          metadata: map()
        }

  @impl true
  def start_session(workspace, opts \\ []) do
    with :ok <- validate_workspace_cwd(workspace, opts),
         {:ok, gateway} <- maybe_register_tools(workspace, opts) do
      {:ok,
       %{
         session_uuid: generate_uuid(),
         workspace: Path.expand(workspace),
         command: resolve_command(opts),
         cli_session_id: nil,
         model: Keyword.get(opts, :model),
         gateway_token: Map.get(gateway, :token),
         mcp_config_path: Map.get(gateway, :path),
         mcp_config_backup: Map.get(gateway, :backup),
         metadata: %{}
       }}
    end
  end

  @impl true
  def run_turn(session, prompt, issue, opts \\ []) do
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)
    turn_id = generate_uuid()
    session_id = "#{session.session_uuid}-#{turn_id}"

    emit_message(on_message, :session_started, %{session_id: session_id, thread_id: session.session_uuid, turn_id: turn_id}, %{})

    on_event = fn notification ->
      emit_message(on_message, :notification, %{payload: notification, raw: Jason.encode!(notification)}, %{})
    end

    case CliRunner.run_turn(turn_args(session, prompt, opts), on_event) do
      {:ok, result} ->
        emit_message(on_message, :turn_completed, %{payload: %{"usage" => result.usage}, result: result}, %{usage: result.usage})

        {:ok,
         %{
           result: :turn_completed,
           session_id: session_id,
           thread_id: session.session_uuid,
           turn_id: turn_id,
           cli_session_id: result.cli_session_id,
           usage: result.usage,
           cost_usd: result.cost_usd
         }}

      {:error, {:resume_session_not_found, stale_id}} when session.cli_session_id != nil ->
        # The persisted chat no longer exists in cursor-agent's local store.
        # Restart the turn as a fresh session instead of hard-failing the
        # thread forever; the fresh cli_session_id is persisted upstream, so
        # the thread self-heals for subsequent turns.
        Logger.warning("Cursor resume chat #{inspect(stale_id)} not found for #{issue_context(issue)}; retrying with a fresh session")

        run_turn(%{session | cli_session_id: nil}, prompt, issue, opts)

      {:error, {:turn_failed, "cursor-agent exited with code 1"}} when session.cli_session_id != nil ->
        Logger.warning("Cursor resumed chat #{inspect(session.cli_session_id)} exited for #{issue_context(issue)}; retrying with a fresh session")

        run_turn(%{session | cli_session_id: nil}, prompt, issue, opts)

      {:error, {:turn_failed, "cursor-agent exited with code 1"}} when session.cli_session_id != nil ->
        Logger.warning("Cursor resumed chat #{inspect(session.cli_session_id)} exited for #{issue_context(issue)}; retrying with a fresh session")

        run_turn(%{session | cli_session_id: nil}, prompt, issue, opts)

      {:error, reason} ->
        Logger.warning("Cursor turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{session_id: session_id, reason: reason}, %{})
        {:error, reason}
    end
  end

  @impl true
  def stop_session(%{gateway_token: token} = session) when is_binary(token) do
    ToolGateway.unregister_session(token)
    restore_mcp_config(session)
    :ok
  end

  def stop_session(_session), do: :ok

  @impl true
  @spec normalize_event(map()) :: map()
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> Map.put(:rate_limits, event[:rate_limits] || Map.get(event, "rate_limits"))
  end

  # ── Private helpers ────────────────────────────────────────────────────────

  defp turn_args(session, prompt, opts) do
    %{
      command: session.command,
      workspace: session.workspace,
      prompt: prompt,
      session_uuid: session.session_uuid,
      cli_session_id: session.cli_session_id,
      model: Keyword.get(opts, :model, session.model),
      mcp_config_path: session.mcp_config_path,
      execution_mode: Keyword.get(opts, :execution_mode),
      timeout_ms: Config.agent_turn_timeout_ms()
    }
  end

  defp maybe_register_tools(workspace, opts) do
    specs = Keyword.get(opts, :dynamic_tools, [])
    executor = Keyword.get(opts, :tool_executor)

    if specs != [] and is_function(executor, 2) do
      with {:ok, token, url} <- ToolGateway.register_session(specs, wrap_executor(executor)) do
        {path, backup} = write_mcp_config!(Path.expand(workspace), url)
        {:ok, %{token: token, path: path, backup: backup}}
      end
    else
      {:ok, %{}}
    end
  end

  # cursor-agent only reads MCP servers from <workspace>/.cursor/mcp.json, so
  # the gateway entry is merged into any existing config. The pre-existing
  # raw content is kept so stop_session can restore the file untouched.
  defp write_mcp_config!(workspace, url) do
    dir = Path.join(workspace, ".cursor")
    File.mkdir_p!(dir)
    path = Path.join(dir, "mcp.json")

    backup =
      case File.read(path) do
        {:ok, raw} -> raw
        {:error, _reason} -> nil
      end

    existing =
      with raw when is_binary(raw) <- backup,
           {:ok, decoded} when is_map(decoded) <- Jason.decode(raw) do
        decoded
      else
        _ -> %{}
      end

    servers = Map.get(existing, "mcpServers", %{})
    config = Map.put(existing, "mcpServers", Map.put(servers, @mcp_server_name, %{"url" => url}))

    File.write!(path, Jason.encode!(config))
    {path, backup}
  end

  defp restore_mcp_config(%{mcp_config_path: path, mcp_config_backup: backup}) when is_binary(path) do
    if is_binary(backup) do
      File.write(path, backup)
    else
      File.rm(path)
    end

    :ok
  end

  defp restore_mcp_config(_session), do: :ok

  # The CLI prefixes MCP tools; executors know bare names.
  defp wrap_executor(executor) do
    fn name, arguments ->
      executor.(String.replace_prefix(name, "mcp__#{@mcp_server_name}__", ""), arguments)
    end
  end

  defp resolve_command(opts) do
    Keyword.get(opts, :cursor_command) || SymphonyElixir.Cursor.Config.command()
  end

  defp generate_uuid do
    <<a::32, b::16, c::16, d::16, e::48>> = :crypto.strong_rand_bytes(16)

    :io_lib.format(~c"~8.16.0b-~4.16.0b-4~3.16.0b-~4.16.0b-~12.16.0b", [
      a,
      b,
      Bitwise.band(c, 0xFFF),
      Bitwise.bor(Bitwise.band(d, 0x3FFF), 0x8000),
      e
    ])
    |> IO.iodata_to_binary()
  end

  defp validate_workspace_cwd(workspace, opts) when is_binary(workspace) and is_list(opts) do
    workspace_path = Path.expand(workspace)
    workspace_root = opts |> resolve_workspace_root() |> Path.expand()

    root_prefix = workspace_root <> "/"

    cond do
      workspace_path == workspace_root ->
        {:error, {:invalid_workspace_cwd, :workspace_root, workspace_path}}

      not String.starts_with?(workspace_path <> "/", root_prefix) ->
        {:error, {:invalid_workspace_cwd, :outside_workspace_root, workspace_path, workspace_root}}

      true ->
        :ok
    end
  end

  defp resolve_workspace_root(opts) do
    case Keyword.get(opts, :workspace_root) do
      root when is_binary(root) and root != "" -> root
      _ -> Config.workspace_root()
    end
  end

  defp issue_context(%{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp normalize_usage(event) do
    payloads = [
      event[:usage],
      Map.get(event, "usage"),
      event[:payload],
      Map.get(event, "payload"),
      event[:result] && Map.get(event[:result], :usage),
      event
    ]

    usage =
      Enum.find_value(payloads, &canonicalize_usage/1) ||
        Enum.find_value(payloads, &turn_completed_usage/1)

    Map.put(event, :usage, usage)
  end

  defp turn_completed_usage(payload) when is_map(payload) do
    method = Map.get(payload, "method") || Map.get(payload, :method)

    if method in ["turn/completed", :turn_completed] do
      usage =
        Map.get(payload, "usage") || Map.get(payload, :usage) ||
          get_in(payload, ["params", "usage"]) || get_in(payload, [:params, :usage])

      canonicalize_usage(usage)
    end
  end

  defp turn_completed_usage(_), do: nil

  defp canonicalize_usage(nil), do: nil

  defp canonicalize_usage(raw) when is_map(raw) do
    input =
      token_value(
        raw,
        ~w(input_tokens prompt_tokens inputTokens promptTokens cacheReadTokens cacheWriteTokens)a ++
          ~w(input_tokens prompt_tokens inputTokens promptTokens cacheReadTokens cacheWriteTokens)
      )

    output =
      token_value(
        raw,
        ~w(output_tokens completion_tokens outputTokens completionTokens reasoningTokens)a ++
          ~w(output_tokens completion_tokens outputTokens completionTokens reasoningTokens)
      )

    total = token_value(raw, ~w(total_tokens total totalTokens)a ++ ~w(total_tokens total totalTokens))

    input = input || 0
    output = output || 0
    total = total || input + output

    if input > 0 or output > 0 or total > 0 do
      %{input_tokens: input, output_tokens: output, total_tokens: total}
    end
  end

  defp token_value(map, keys) do
    Enum.find_value(keys, fn key ->
      map |> Map.get(key) |> parse_token_value()
    end)
  end

  defp parse_token_value(v) when is_integer(v) and v >= 0, do: v

  defp parse_token_value(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {n, _} when n >= 0 -> n
      _ -> nil
    end
  end

  defp parse_token_value(_), do: nil

  defp emit_message(on_message, event, details, metadata) when is_function(on_message, 1) do
    message = metadata |> Map.merge(details) |> Map.put(:event, event) |> Map.put(:timestamp, DateTime.utc_now())
    on_message.(message)
  end

  defp default_on_message(_message), do: :ok
end
