defmodule SymphonyElixir.AgentLifecycle.Resolver do
  @moduledoc """
  Resolves a provider CLI from its preferred source with a reversible fallback.

  Fallback is evaluated on every resolution. A temporarily broken managed
  install therefore falls back to PATH without mutating the preference, and
  automatically recovers once the managed executable is healthy again.
  """

  alias SymphonyElixir.AgentLifecycle.{Installer, Probe}
  alias SymphonyElixir.Settings.AgentCli

  defmodule Result do
    @moduledoc "Immutable launch provenance returned by the source resolver."
    @enforce_keys [:preferred_source, :effective_source, :executable_path, :probed_at]
    defstruct [
      :preferred_source,
      :effective_source,
      :executable_path,
      :version,
      :fallback_reason,
      :probed_at
    ]
  end

  @spec resolve(String.t(), keyword()) :: {:ok, Result.t()} | {:error, map()}
  def resolve(agent, options \\ []) when is_binary(agent) do
    preferred = preferred_source(agent, options)
    managed_probe = Keyword.get(options, :managed_probe, fn -> probe_managed(agent) end)
    path_probe = Keyword.get(options, :path_probe, fn -> Probe.path(agent) end)
    now = Keyword.get(options, :now, fn -> System.system_time(:millisecond) end)

    case preferred do
      :managed -> choose(:managed, managed_probe, path_probe, now)
      :path -> choose(:path, path_probe, managed_probe, now)
    end
  end

  defp choose(preferred, preferred_probe, fallback_probe, now) do
    fallback = opposite(preferred)

    case preferred_probe.() do
      {:ok, result} ->
        {:ok, present(preferred, preferred, result, nil, now)}

      {:error, preferred_reason} ->
        case fallback_probe.() do
          {:ok, result} ->
            {:ok, present(preferred, fallback, result, preferred_reason, now)}

          {:error, fallback_reason} ->
            {:error,
             Map.merge(
               %{preferred_source: preferred},
               %{preferred => preferred_reason, fallback => fallback_reason}
             )}
        end
    end
  end

  defp present(preferred, effective, result, fallback_reason, now) do
    %Result{
      preferred_source: preferred,
      effective_source: effective,
      executable_path: fetch_path(result),
      version: fetch_value(result, :version),
      fallback_reason: fallback_reason,
      probed_at: now.()
    }
  end

  defp probe_managed(agent) do
    with {:ok, manifest} <- Installer.current(agent),
         path when is_binary(path) <- manifest["executable_path"],
         {:ok, probe} <- Probe.executable(agent, path) do
      {:ok, %{path: path, version: manifest["version"] || probe.version}}
    else
      {:error, :not_installed} -> {:error, :managed_missing}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :managed_manifest_invalid}
    end
  end

  defp preferred_source(agent, options) do
    case Keyword.get(options, :preferred_source) do
      source when source in [:managed, :path] ->
        source

      nil ->
        case AgentCli.for(agent) do
          %{"preferred_source" => "path"} -> :path
          _ -> :managed
        end
    end
  end

  defp fetch_path(%{path: path}), do: path
  defp fetch_path(%{"path" => path}), do: path

  defp fetch_value(map, key) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp opposite(:managed), do: :path
  defp opposite(:path), do: :managed
end
