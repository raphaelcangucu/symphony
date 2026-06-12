defmodule SymphonyElixir.Claude.CodingAgent do
  @moduledoc """
  Native Claude Code backend implementing the CodingAgent behaviour by
  spawning the `claude` CLI per turn (no external bridge). Tools are served
  through the component-owned MCP ToolGateway; events are translated by
  CliRunner into the bridge vocabulary the rest of Symphony understands.
  """

  @behaviour SymphonyElixir.CodingAgent

  require Logger

  alias SymphonyElixir.Claude.AppServer.{CliRunner, ToolGateway}
  alias SymphonyElixir.Config

  @permission_mode "bypassPermissions"

  @type session :: %{
          session_uuid: String.t(),
          workspace: Path.t(),
          command: String.t(),
          cli_session_id: String.t() | nil,
          model: String.t() | nil,
          effort: String.t() | nil,
          gateway_token: String.t() | nil,
          mcp_config_path: Path.t() | nil,
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
         effort: Keyword.get(opts, :effort),
         gateway_token: Map.get(gateway, :token),
         mcp_config_path: Map.get(gateway, :path),
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
      emit_message(on_message, :notification, %{payload: notification, raw: Jason.encode!(notification)}, usage_metadata(notification))
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
        # The persisted backend session no longer exists in claude's local store
        # (wiped session storage, or an id recorded while the backend was
        # misconfigured). Restart the turn as a fresh session instead of
        # hard-failing the thread forever; the fresh cli_session_id is persisted
        # upstream, so the thread self-heals for subsequent turns.
        Logger.warning("Claude resume session #{inspect(stale_id)} not found for #{issue_context(issue)}; retrying with a fresh session")

        run_turn(%{session | cli_session_id: nil}, prompt, issue, opts)

      {:error, {:turn_failed, "claude exited with code 1"}} when session.cli_session_id != nil ->
        # A resumed Claude session can exit non-zero when the local conversation
        # ended outside Symphony. Retry once as a fresh session before failing.
        Logger.warning("Claude resumed session #{inspect(session.cli_session_id)} exited for #{issue_context(issue)}; retrying with a fresh session")

        run_turn(%{session | cli_session_id: nil}, prompt, issue, opts)

      {:error, reason} ->
        Logger.warning("Claude turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{session_id: session_id, reason: reason}, %{})
        {:error, reason}
    end
  end

  @impl true
  def stop_session(%{gateway_token: token, mcp_config_path: path}) do
    if is_binary(token), do: ToolGateway.unregister_session(token)
    if is_binary(path), do: File.rm(path)
    :ok
  end

  def stop_session(_session), do: :ok

  @impl true
  @spec normalize_event(map()) :: map()
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> normalize_rate_limits()
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
      effort: Keyword.get(opts, :effort, session.effort),
      mcp_config_path: session.mcp_config_path,
      permission_mode: @permission_mode,
      timeout_ms: Config.agent_turn_timeout_ms()
    }
  end

  defp maybe_register_tools(workspace, opts) do
    specs = Keyword.get(opts, :dynamic_tools, [])
    executor = Keyword.get(opts, :tool_executor)

    if specs != [] and is_function(executor, 2) do
      with {:ok, token, url} <- ToolGateway.register_session(specs, wrap_executor(executor)) do
        {:ok, %{token: token, path: ToolGateway.write_mcp_config!(Path.expand(workspace), url)}}
      end
    else
      {:ok, %{}}
    end
  end

  # The CLI prefixes MCP tools as mcp__symphony__<name>; executors know bare names.
  defp wrap_executor(executor) do
    fn name, arguments ->
      executor.(String.replace_prefix(name, "mcp__symphony__", ""), arguments)
    end
  end

  defp resolve_command(opts) do
    Keyword.get(opts, :claude_command) || SymphonyElixir.Claude.Config.command()
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

  defp usage_metadata(%{"method" => "usage/update", "params" => %{"usage" => usage}}), do: %{usage: usage}
  defp usage_metadata(_notification), do: %{}

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
    raw = event[:usage] || Map.get(event, "usage")

    usage =
      if is_map(raw) do
        input =
          token_value(
            raw,
            ~w(input_tokens prompt_tokens inputTokens promptTokens)a ++
              ~w(input_tokens prompt_tokens inputTokens promptTokens)
          )

        output =
          token_value(
            raw,
            ~w(output_tokens completion_tokens outputTokens completionTokens)a ++
              ~w(output_tokens completion_tokens outputTokens completionTokens)
          )

        total = token_value(raw, ~w(total_tokens total totalTokens)a ++ ~w(total_tokens total totalTokens))

        if input || output || total do
          %{input_tokens: input || 0, output_tokens: output || 0, total_tokens: total || 0}
        end
      end

    Map.put(event, :usage, usage)
  end

  defp normalize_rate_limits(event) do
    raw = event[:rate_limits] || Map.get(event, "rate_limits")
    Map.put(event, :rate_limits, raw)
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
