defmodule SymphonyElixir.AgentAvailability do
  @moduledoc """
  Probes whether the codex/claude/cursor CLI binaries are present, with a
  short cache so the Settings page can poll cheaply. Claude is probed through
  its full configured shell command so env prefixes and wrappers match turns.
  """

  alias SymphonyElixir.Claude.Config, as: ClaudeConfig
  alias SymphonyElixir.InstanceConfig

  @cache_key {__MODULE__, :cache}
  @cache_ttl_ms 60_000
  @claude_goal_min_version "2.1.139"

  @type result :: %{
          available: boolean(),
          version: String.t() | nil,
          command: String.t(),
          path: String.t() | nil,
          authenticated: boolean() | nil,
          detail: String.t() | nil
        }

  @spec probe() :: %{
          codex: result(),
          claude: result(),
          cursor: result(),
          opencode: result()
        }
  def probe do
    case cached() do
      {:ok, value} ->
        value

      :miss ->
        value = %{
          codex: probe_command(InstanceConfig.codex_command()),
          claude: probe_claude_command(ClaudeConfig.resolve_command()),
          cursor: probe_command(InstanceConfig.cursor_command()),
          opencode: probe_command(InstanceConfig.opencode_command())
        }

        :persistent_term.put(@cache_key, {value, now_ms()})
        value
    end
  end

  @spec probe_command(String.t()) :: result()
  def probe_command(command) when is_binary(command) do
    binary = command |> String.split(" ", trim: true) |> List.first() || command

    case System.find_executable(binary) do
      nil ->
        %{
          available: false,
          version: nil,
          command: binary,
          path: nil,
          authenticated: nil,
          detail: nil
        }

      path ->
        %{
          available: true,
          version: read_version(path),
          command: binary,
          path: path,
          authenticated: nil,
          detail: nil
        }
    end
  end

  @spec invalidate_cache() :: :ok
  def invalidate_cache do
    :persistent_term.erase(@cache_key)
    :ok
  end

  @doc """
  True when the probed Claude CLI version is >= 2.1.139 (native `/goal`).

  Override with `Application.put_env(:symphony_elixir, :claude_goal_supported_override, true|false)`
  in tests.
  """
  @spec claude_goal_supported?() :: boolean()
  def claude_goal_supported? do
    claude_goal_supported?(ClaudeConfig.resolve_command())
  end

  @spec claude_goal_supported?(String.t()) :: boolean()
  def claude_goal_supported?(command) when is_binary(command) do
    claude_goal_supported?(command, nil)
  end

  defp claude_goal_supported?(command, workspace) do
    case Application.get_env(:symphony_elixir, :claude_goal_supported_override) do
      true ->
        true

      false ->
        false

      _ ->
        min =
          Application.get_env(:symphony_elixir, :claude_goal_min_version, @claude_goal_min_version)

        case probe_claude_command(command, workspace) do
          %{available: true, version: version} when is_binary(version) ->
            version_at_least?(version, min)

          _ ->
            false
        end
    end
  end

  @doc """
  Verifies that native Claude Goal mode can be activated in `workspace`.

  The version gate proves `/goal` exists. The remaining checks fail fast for
  headless launches that cannot establish a trusted workspace or load project
  hooks. Tests may provide an exact result through
  `:claude_goal_preflight_override`.
  """
  @spec claude_goal_preflight(Path.t()) :: :ok | {:error, atom()}
  def claude_goal_preflight(workspace) when is_binary(workspace) do
    claude_goal_preflight(workspace, ClaudeConfig.resolve_command())
  end

  @spec claude_goal_preflight(Path.t(), String.t()) :: :ok | {:error, atom()}
  def claude_goal_preflight(workspace, command)
      when is_binary(workspace) and is_binary(command) do
    case Application.get_env(:symphony_elixir, :claude_goal_preflight_override) do
      :ok ->
        :ok

      {:error, reason} when is_atom(reason) ->
        {:error, reason}

      _ ->
        with true <- claude_goal_supported?(command, workspace) || {:error, :claude_goal_unsupported_version},
             true <- File.dir?(workspace) || {:error, :claude_workspace_untrusted},
             :ok <- validate_claude_settings(workspace) do
          :ok
        end
    end
  end

  @spec version_at_least?(String.t() | nil, String.t()) :: boolean()
  def version_at_least?(version, minimum) when is_binary(minimum) do
    case {parse_semver(version), parse_semver(minimum)} do
      {nil, _} -> false
      {current, min} -> version_gte?(current, min)
    end
  end

  def version_at_least?(_version, _minimum), do: false

  defp parse_semver(text) when is_binary(text) do
    case Regex.run(~r/(\d+)\.(\d+)\.(\d+)/, text) do
      [_, a, b, c] -> {String.to_integer(a), String.to_integer(b), String.to_integer(c)}
      _ -> nil
    end
  end

  defp parse_semver(_text), do: nil

  defp version_gte?({a, b, c}, {x, y, z}) do
    cond do
      a > x -> true
      a < x -> false
      b > y -> true
      b < y -> false
      true -> c >= z
    end
  end

  defp read_version(path) do
    case System.cmd(path, ["--version"], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> List.first()
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp probe_claude_command(command, workspace \\ nil) do
    case ClaudeConfig.read_version(command, workspace) do
      version when is_binary(version) ->
        %{
          available: true,
          version: version,
          command: command,
          path: nil,
          authenticated: nil,
          detail: nil
        }

      nil ->
        %{
          available: false,
          version: nil,
          command: command,
          path: nil,
          authenticated: nil,
          detail: nil
        }
    end
  end

  defp cached do
    case :persistent_term.get(@cache_key, :miss) do
      {value, at} -> if now_ms() - at < @cache_ttl_ms, do: {:ok, value}, else: :miss
      :miss -> :miss
    end
  end

  defp now_ms, do: System.monotonic_time(:millisecond)

  defp validate_claude_settings(workspace) do
    settings = Path.join([workspace, ".claude", "settings.json"])

    case File.read(settings) do
      {:ok, contents} ->
        case Jason.decode(contents) do
          {:ok, decoded} when is_map(decoded) -> :ok
          _ -> {:error, :claude_hooks_unavailable}
        end

      {:error, :enoent} ->
        :ok

      {:error, _reason} ->
        {:error, :claude_hooks_unavailable}
    end
  end
end
