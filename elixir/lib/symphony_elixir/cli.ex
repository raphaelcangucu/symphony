defmodule SymphonyElixir.CLI do
  @moduledoc """
  Escript entrypoint for running Symphony.

  Per-project behavior is DB-owned (`workflow_markdown`) and process settings
  come from `SYMPHONY_*` env, so no global WORKFLOW.md path is required.
  """

  alias SymphonyElixir.Agent.CLI, as: AgentCLI
  alias SymphonyElixir.Claude.AppServer.StdioMain
  alias SymphonyElixir.LogFile

  @acknowledgement_switch :i_understand_that_this_will_be_running_without_the_usual_guardrails
  @version Mix.Project.config()[:version]
  @git_rev_suffix (case System.cmd("git", ["rev-parse", "--short", "HEAD"], stderr_to_stdout: true) do
                     {rev, 0} ->
                       case String.trim(rev) do
                         "" -> ""
                         trimmed -> " " <> trimmed
                       end

                     _ ->
                       ""
                   end)
  @switches [{@acknowledgement_switch, :boolean}, logs_root: :string, port: :integer, version: :boolean]

  @type ensure_started_result :: {:ok, [atom()]} | {:error, term()}
  @type deps :: %{
          set_logs_root: (String.t() -> :ok | {:error, term()}),
          set_server_port_override: (non_neg_integer() | nil -> :ok | {:error, term()}),
          ensure_all_started: (-> ensure_started_result())
        }

  @spec main([String.t()]) :: no_return()
  def main(["claude-app-server" | rest]) do
    StdioMain.run(rest)
  end

  def main(["agent" | rest]) do
    AgentCLI.main(rest)
  end

  def main(args) do
    case evaluate(args) do
      :ok ->
        wait_for_shutdown()

      {:version, version} ->
        IO.puts("symphony #{version} (sapsaldog/symphony#{@git_rev_suffix})")

      {:error, message} ->
        IO.puts(:stderr, message)
        System.halt(1)
    end
  end

  @spec evaluate([String.t()], deps()) :: :ok | {:version, String.t()} | {:error, String.t()}
  def evaluate(args, deps \\ runtime_deps()) do
    case OptionParser.parse(args, strict: @switches) do
      {[version: true], _, _} ->
        {:version, @version}

      {opts, [], []} ->
        with :ok <- require_guardrails_acknowledgement(opts),
             :ok <- maybe_set_logs_root(opts, deps),
             :ok <- maybe_set_server_port(opts, deps) do
          run(deps)
        end

      _ ->
        {:error, usage_message()}
    end
  end

  @spec run(deps()) :: :ok | {:error, String.t()}
  def run(deps) do
    case deps.ensure_all_started.() do
      {:ok, _started_apps} ->
        :ok

      {:error, reason} ->
        {:error, "Failed to start #{SymphonyElixir.Branding.cli_product_name()}: #{inspect(reason)}"}
    end
  end

  @spec usage_message() :: String.t()
  defp usage_message do
    "Usage: symphony [--logs-root <path>] [--port <port>]\n       symphony agent <providers|capabilities|run|steer|goal> [options]"
  end

  @spec runtime_deps() :: deps()
  defp runtime_deps do
    %{
      set_logs_root: &set_logs_root/1,
      set_server_port_override: &set_server_port_override/1,
      ensure_all_started: fn -> Application.ensure_all_started(:symphony_elixir) end
    }
  end

  defp maybe_set_logs_root(opts, deps) do
    case Keyword.get_values(opts, :logs_root) do
      [] ->
        :ok

      values ->
        logs_root = values |> List.last() |> String.trim()

        if logs_root == "" do
          {:error, usage_message()}
        else
          :ok = deps.set_logs_root.(Path.expand(logs_root))
        end
    end
  end

  defp require_guardrails_acknowledgement(opts) do
    if Keyword.get(opts, @acknowledgement_switch, false) do
      :ok
    else
      {:error, acknowledgement_banner()}
    end
  end

  @spec acknowledgement_banner() :: String.t()
  defp acknowledgement_banner do
    product = SymphonyElixir.Branding.cli_product_name()

    lines = [
      "This #{product} implementation is a low key engineering preview.",
      "Codex will run without any guardrails.",
      "#{product} is not a supported product and is presented as-is.",
      "To proceed, start with `--i-understand-that-this-will-be-running-without-the-usual-guardrails` CLI argument"
    ]

    width = Enum.max(Enum.map(lines, &String.length/1))
    border = String.duplicate("─", width + 2)
    top = "╭" <> border <> "╮"
    bottom = "╰" <> border <> "╯"
    spacer = "│ " <> String.duplicate(" ", width) <> " │"

    content =
      [
        top,
        spacer
        | Enum.map(lines, fn line ->
            "│ " <> String.pad_trailing(line, width) <> " │"
          end)
      ] ++ [spacer, bottom]

    [
      IO.ANSI.red(),
      IO.ANSI.bright(),
      Enum.join(content, "\n"),
      IO.ANSI.reset()
    ]
    |> IO.iodata_to_binary()
  end

  defp set_logs_root(logs_root) do
    Application.put_env(:symphony_elixir, :log_file, LogFile.default_log_file(logs_root))
    :ok
  end

  defp maybe_set_server_port(opts, deps) do
    case Keyword.get_values(opts, :port) do
      [] ->
        :ok

      values ->
        port = List.last(values)

        if is_integer(port) and port >= 0 do
          :ok = deps.set_server_port_override.(port)
        else
          {:error, usage_message()}
        end
    end
  end

  defp set_server_port_override(port) when is_integer(port) and port >= 0 do
    Application.put_env(:symphony_elixir, :server_port_override, port)
    :ok
  end

  @spec wait_for_shutdown() :: no_return()
  defp wait_for_shutdown do
    case Process.whereis(SymphonyElixir.Supervisor) do
      nil ->
        IO.puts(:stderr, "#{SymphonyElixir.Branding.cli_product_name()} supervisor is not running")
        System.halt(1)

      pid ->
        ref = Process.monitor(pid)

        receive do
          {:DOWN, ^ref, :process, ^pid, reason} ->
            case reason do
              :normal -> System.halt(0)
              _ -> System.halt(1)
            end
        end
    end
  end
end
