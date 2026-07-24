defmodule Mix.Tasks.Symphony.Daemon do
  use Mix.Task

  @shortdoc "Manage the installed Symphony user daemon"

  @impl true
  def run(argv) do
    case SymphonyElixir.Daemon.CLI.run(["daemon" | argv]) do
      {:ok, result} -> Mix.shell().info(result.output)
      {:error, result} -> Mix.raise(result.output)
    end
  end

  @doc false
  @spec parse([String.t()]) ::
          {:ok, SymphonyElixir.Daemon.CLI.command()} | {:error, String.t()}
  def parse(argv), do: SymphonyElixir.Daemon.CLI.parse(["daemon" | argv])
end
