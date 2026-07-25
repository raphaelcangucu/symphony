defmodule SymphonyElixir.Release do
  @moduledoc "One-off entrypoints invoked by OTP release scripts."

  alias SymphonyElixir.Daemon.{CLI, Environment, Preflight}

  @spec daemon([String.t()]) :: no_return()
  def daemon(argv) when is_list(argv) do
    case load_installed_environment(System.get_env("SYMPHONY_INSTALLED_ENV_FILE")) do
      :ok ->
        CLI.main(argv)

      {:error, reason} ->
        IO.puts(:stderr, "installed environment is invalid: #{inspect(reason)}")
        System.halt(78)
    end
  end

  @doc false
  @spec load_installed_environment(Path.t() | nil) :: :ok | {:error, term()}
  def load_installed_environment(nil), do: :ok
  def load_installed_environment(""), do: :ok

  def load_installed_environment(path) do
    with {:ok, env} <- Environment.read(path) do
      System.put_env(env)
      :ok
    end
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
