defmodule SymphonyElixir.Daemon.CLI do
  @moduledoc "Parser and presenter for installed-daemon management."

  alias SymphonyElixir.Daemon.Lifecycle

  @usage """
  Usage:
    symphony daemon install [--artifact PATH] [--migrate-from PATH] [--force] [--enable-linger] --i-understand-that-this-will-be-running-without-the-usual-guardrails
    symphony daemon start
    symphony daemon stop
    symphony daemon restart [--force]
    symphony daemon status [--json]
    symphony daemon uninstall
  """

  @type command ::
          {:install, map()}
          | {:start, map()}
          | {:stop, map()}
          | {:restart, map()}
          | {:status, map()}
          | {:uninstall, map()}

  @type run_result ::
          {:ok, %{exit_code: 0, output: String.t()}}
          | {:error, %{exit_code: 1 | 2 | 78, output: String.t()}}

  @spec parse([String.t()]) :: {:ok, command()} | {:error, String.t()}
  def parse(["daemon", command | argv]) do
    parse_command(command, argv)
  end

  def parse(_argv), do: {:error, @usage}

  @spec run([String.t()], keyword()) :: run_result()
  def run(argv, opts \\ []) do
    deps = Map.merge(runtime_deps(), Map.new(Keyword.get(opts, :deps, %{})))

    case parse(argv) do
      {:ok, command} -> execute(command, deps)
      {:error, message} -> {:error, %{exit_code: 2, output: message}}
    end
  end

  @spec main([String.t()]) :: no_return()
  def main(argv) do
    case run(argv) do
      {:ok, result} ->
        write_output(:stdio, result.output)
        System.halt(result.exit_code)

      {:error, result} ->
        write_output(:stderr, result.output)
        System.halt(result.exit_code)
    end
  end

  defp parse_command("status", argv),
    do: strict_parse(argv, [json: :boolean], fn opts -> {:status, %{json: opts[:json] || false}} end)

  defp parse_command("restart", argv),
    do: strict_parse(argv, [force: :boolean], fn opts -> {:restart, %{force: opts[:force] || false}} end)

  defp parse_command("start", argv),
    do: strict_parse(argv, [], fn _opts -> {:start, %{}} end)

  defp parse_command("stop", argv),
    do: strict_parse(argv, [], fn _opts -> {:stop, %{}} end)

  defp parse_command("uninstall", argv),
    do: strict_parse(argv, [], fn _opts -> {:uninstall, %{}} end)

  defp parse_command("install", argv) do
    switches = [
      artifact: :string,
      migrate_from: :string,
      force: :boolean,
      enable_linger: :boolean,
      i_understand_that_this_will_be_running_without_the_usual_guardrails: :boolean
    ]

    strict_parse(argv, switches, fn opts ->
      {:install,
       %{
         artifact: opts[:artifact],
         migrate_from: opts[:migrate_from],
         force: opts[:force] || false,
         enable_linger: opts[:enable_linger] || false,
         acknowledged: opts[:i_understand_that_this_will_be_running_without_the_usual_guardrails] || false
       }}
    end)
  end

  defp parse_command(_command, _argv), do: {:error, @usage}

  defp strict_parse(argv, switches, build) do
    case OptionParser.parse(argv, strict: switches) do
      {opts, [], []} -> {:ok, build.(opts)}
      _ -> {:error, @usage}
    end
  end

  defp execute({:status, %{json: json?}}, deps) do
    case deps.status.() do
      {:ok, status} ->
        output = if json?, do: Jason.encode!(status), else: human_status(status)

        if status[:state] == :healthy do
          {:ok, %{exit_code: 0, output: output}}
        else
          {:error, %{exit_code: 1, output: output}}
        end

      {:error, reason} ->
        failure(reason)
    end
  end

  defp execute({:start, _options}, deps), do: lifecycle_result(deps.start.())
  defp execute({:stop, _options}, deps), do: lifecycle_result(deps.stop.())
  defp execute({:restart, options}, deps), do: lifecycle_result(deps.restart.(options.force))
  defp execute({:install, options}, deps), do: lifecycle_result(deps.install.(options))
  defp execute({:uninstall, _options}, deps), do: lifecycle_result(deps.uninstall.())

  defp lifecycle_result(:ok), do: {:ok, %{exit_code: 0, output: "ok"}}
  defp lifecycle_result({:ok, value}), do: {:ok, %{exit_code: 0, output: human_value(value)}}
  defp lifecycle_result({:error, {:preflight, message}}), do: {:error, %{exit_code: 78, output: message}}
  defp lifecycle_result({:error, reason}), do: failure(reason)

  defp failure(reason),
    do: {:error, %{exit_code: 1, output: "daemon command failed: #{Kernel.inspect(reason)}"}}

  defp human_status(status) do
    "state=#{status[:state]} active=#{status[:active?]} healthy=#{status[:healthy?]} drift=#{Kernel.inspect(status[:drift] || [])}"
  end

  defp human_value(value) when is_binary(value), do: value
  defp human_value(value), do: Kernel.inspect(value)

  defp runtime_deps do
    %{
      status: fn -> Lifecycle.status() end,
      start: fn -> Lifecycle.start() end,
      stop: fn -> Lifecycle.stop() end,
      restart: fn force? -> Lifecycle.restart(force: force?) end,
      install: fn options ->
        apply(SymphonyElixir.Daemon.Install, :run, [options.artifact, Map.to_list(options)])
      end,
      uninstall: fn -> apply(SymphonyElixir.Daemon.Install, :uninstall, [[]]) end
    }
  end

  defp write_output(_device, ""), do: :ok
  defp write_output(device, output), do: IO.puts(device, output)
end
