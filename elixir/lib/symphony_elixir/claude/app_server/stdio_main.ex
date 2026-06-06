defmodule SymphonyElixir.Claude.AppServer.StdioMain do
  @moduledoc """
  Standalone entrypoint: serves the Codex app-server protocol over stdio,
  backed by the native Claude CLI runner. A dynamicTools-capable drop-in for
  the retired symphony-claude TS bridge. Never starts the Repo (escript-safe).
  """

  alias SymphonyElixir.Claude.AppServer.Server

  @spec run([String.t()]) :: no_return()
  def run(_argv) do
    Application.ensure_all_started(:logger)
    Application.ensure_all_started(:crypto)
    Application.ensure_all_started(:jason)

    {:ok, server} = Server.start_link(sender: &write_stdout/1)
    loop(server)
  end

  defp loop(server) do
    case IO.read(:stdio, :line) do
      :eof ->
        System.halt(0)

      {:error, _reason} ->
        System.halt(1)

      line ->
        case Jason.decode(String.trim(line)) do
          {:ok, message} -> Server.handle_message(server, message)
          {:error, _} -> :ok
        end

        loop(server)
    end
  end

  defp write_stdout(payload) do
    IO.puts(:stdio, Jason.encode!(Map.put_new(payload, "jsonrpc", "2.0")))
  end
end
