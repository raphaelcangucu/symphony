defmodule SymphonyElixir.Daemon.Systemd do
  @moduledoc "Typed adapter around user systemd commands."

  @properties "LoadState,UnitFileState,ActiveState,SubState,MainPID,NRestarts,Result"
  @type runner :: (String.t(), [String.t()], keyword() ->
                     {String.t(), non_neg_integer()})

  @spec show(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def show(unit, opts \\ []) do
    with {:ok, output} <-
           command(
             "systemctl",
             ["--user", "show", unit, "--property=#{@properties}", "--no-pager"],
             opts
           ) do
      {:ok, parse_properties(output)}
    end
  end

  @spec daemon_reload(keyword()) :: :ok | {:error, term()}
  def daemon_reload(opts \\ []),
    do: ok_command("systemctl", ["--user", "daemon-reload"], opts)

  @spec enable_now(String.t(), keyword()) :: :ok | {:error, term()}
  def enable_now(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "enable", "--now", unit], opts)

  @spec start(String.t(), keyword()) :: :ok | {:error, term()}
  def start(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "start", unit], opts)

  @spec stop(String.t(), keyword()) :: :ok | {:error, term()}
  def stop(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "stop", unit], opts)

  @spec restart(String.t(), keyword()) :: :ok | {:error, term()}
  def restart(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "restart", unit], opts)

  @spec force_restart(String.t(), keyword()) :: :ok | {:error, term()}
  def force_restart(unit, opts \\ []) do
    ok_command(
      "systemctl",
      ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit],
      opts
    )
  end

  @spec disable_now(String.t(), keyword()) :: :ok | {:error, term()}
  def disable_now(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "disable", "--now", unit], opts)

  @spec enable_linger(String.t(), keyword()) :: :ok | {:error, term()}
  def enable_linger(user, opts \\ []),
    do: ok_command("loginctl", ["enable-linger", user], opts)

  @spec linger(String.t(), keyword()) ::
          {:ok, boolean()} | {:error, term()}
  def linger(user, opts \\ []) do
    with {:ok, output} <-
           command("loginctl", ["show-user", user, "--property=Linger", "--value"], opts) do
      {:ok, String.trim(output) == "yes"}
    end
  end

  defp ok_command(executable, args, opts) do
    case command(executable, args, opts) do
      {:ok, _output} -> :ok
      error -> error
    end
  end

  defp command(executable, args, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/3)

    case runner.(executable, args, stderr_to_stdout: true) do
      {output, 0} ->
        {:ok, output}

      {output, status} ->
        {:error, {:command_failed, status, String.trim(output)}}
    end
  end

  defp default_runner(executable, args, opts) do
    System.cmd(executable, args, opts)
  end

  defp parse_properties(output) do
    output
    |> String.split("\n", trim: true)
    |> Map.new(fn line ->
      [key, value] = String.split(line, "=", parts: 2)
      {key, value}
    end)
  end
end
