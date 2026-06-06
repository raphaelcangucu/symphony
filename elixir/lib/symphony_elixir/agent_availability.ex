defmodule SymphonyElixir.AgentAvailability do
  @moduledoc """
  Probes whether the codex/claude CLI binaries are present, with a short
  cache so the Settings page can poll cheaply. The probed binary is the
  first word of the configured command.
  """

  alias SymphonyElixir.InstanceConfig

  @cache_key {__MODULE__, :cache}
  @cache_ttl_ms 60_000

  @type result :: %{available: boolean(), version: String.t() | nil, command: String.t()}

  @spec probe() :: %{codex: result(), claude: result()}
  def probe do
    case cached() do
      {:ok, value} ->
        value

      :miss ->
        value = %{
          codex: probe_command(InstanceConfig.codex_command()),
          claude: probe_command(InstanceConfig.claude_command())
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
        %{available: false, version: nil, command: binary}

      path ->
        %{available: true, version: read_version(path), command: binary}
    end
  end

  @spec invalidate_cache() :: :ok
  def invalidate_cache do
    :persistent_term.erase(@cache_key)
    :ok
  end

  defp read_version(path) do
    case System.cmd(path, ["--version"], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> List.first()
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp cached do
    case :persistent_term.get(@cache_key, :miss) do
      {value, at} -> if now_ms() - at < @cache_ttl_ms, do: {:ok, value}, else: :miss
      :miss -> :miss
    end
  end

  defp now_ms, do: System.monotonic_time(:millisecond)
end
