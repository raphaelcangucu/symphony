defmodule SymphonyElixir.Daemon.BuildInfo do
  @moduledoc "Runtime identity for health and daemon drift checks."

  @started_key {__MODULE__, :started_at}
  @default_version Application.compile_env(:symphony_elixir, :app_version, "dev")
  @default_commit Application.compile_env(:symphony_elixir, :git_commit, "unknown")

  @spec mark_started(DateTime.t()) :: :ok
  def mark_started(now \\ DateTime.utc_now()) do
    :persistent_term.put(@started_key, DateTime.truncate(now, :second))
    :ok
  end

  @spec snapshot() :: map()
  def snapshot do
    configured =
      Application.get_env(:symphony_elixir, :build_info, %{
        version: @default_version,
        git_commit: @default_commit,
        mode: runtime_mode()
      })

    endpoint =
      case SymphonyElixir.Daemon.Configuration.endpoint() do
        {:ok, value} -> value
        {:error, _reason} -> %{host: "invalid", port: 0}
      end

    %{
      version: to_string(configured[:version] || @default_version),
      git_commit: to_string(configured[:git_commit] || @default_commit),
      mode: to_string(configured[:mode] || runtime_mode()),
      started_at: started_at() |> DateTime.to_iso8601(),
      tracker_host: endpoint.host,
      tracker_port: endpoint.port
    }
  end

  defp started_at do
    :persistent_term.get(
      @started_key,
      DateTime.utc_now() |> DateTime.truncate(:second)
    )
  end

  defp runtime_mode do
    if System.get_env("SYMPHONY_RUNTIME_MODE") == "installed",
      do: "installed",
      else: "development"
  end
end
