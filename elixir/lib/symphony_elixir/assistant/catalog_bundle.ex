defmodule SymphonyElixir.Assistant.CatalogBundle do
  @moduledoc """
  Assembles the multi-agent assistant catalog for `GET …/assistant/config`.

  Agent catalogs are fetched in parallel. The assembled bundle is cached briefly
  so repeated sidebar/composer mounts do not re-pay CLI discovery costs.
  """

  alias SymphonyElixir.HotpathCache
  alias SymphonyElixir.Settings

  @cache_key :assistant_catalog_bundle
  @ttl_ms 30_000
  @fetch_timeout_ms 8_000

  @spec fetch() :: %{agents: [map()], default_agent: String.t()}
  def fetch do
    case HotpathCache.fetch(@cache_key) do
      {:ok, bundle} ->
        bundle

      :miss ->
        bundle = build()
        HotpathCache.put(@cache_key, bundle, @ttl_ms)
        bundle
    end
  end

  @spec invalidate() :: :ok
  def invalidate, do: HotpathCache.invalidate(@cache_key)

  defp build do
    agents =
      [
        &SymphonyElixir.Codex.ModelCatalog.list_models/0,
        &SymphonyElixir.Claude.ModelCatalog.list_models/0,
        &SymphonyElixir.Cursor.ModelCatalog.list_models/0,
        &SymphonyElixir.OpenCode.ModelCatalog.list_models/0
      ]
      |> Task.async_stream(
        fn fun ->
          case fun.() do
            {:ok, catalog} -> catalog
            {:error, _reason} -> nil
          end
        end,
        timeout: @fetch_timeout_ms,
        on_timeout: :kill_task,
        ordered: true,
        max_concurrency: 4
      )
      |> Enum.flat_map(fn
        {:ok, catalog} when is_map(catalog) -> [catalog]
        _ -> []
      end)

    %{
      agents: agents,
      default_agent: Settings.Agents.default_agent_kind()
    }
  end
end
