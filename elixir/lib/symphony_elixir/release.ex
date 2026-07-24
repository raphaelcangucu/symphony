defmodule SymphonyElixir.Release do
  @moduledoc "One-off entrypoints invoked by OTP release scripts."

  alias SymphonyElixir.Daemon.{CLI, Preflight}

  @spec daemon([String.t()]) :: no_return()
  def daemon(argv) when is_list(argv) do
    CLI.main(argv)
  end

  @spec preflight() :: no_return()
  def preflight do
    case Preflight.run() do
      {:ok, _warnings} ->
        System.halt(0)

      {:error, message} ->
        IO.puts(:stderr, message)
        System.halt(78)
    end
  end
end
