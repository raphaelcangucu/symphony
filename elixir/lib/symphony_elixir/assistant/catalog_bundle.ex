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

  @spec fetch(keyword()) :: {:ok, map()}
          | {:error, {:assistant_catalog_unavailable, map()}}
  def fetch(opts \\ []) do
    fetchers = Keyword.get(opts, :fetchers, default_fetchers())

    if Keyword.has_key?(opts, :fetchers) do
      build(fetchers)
    else
      case HotpathCache.fetch(@cache_key) do
        {:ok, bundle} ->
          {:ok, bundle}

        :miss ->
          case build(fetchers) do
            {:ok, bundle} = ok ->
              HotpathCache.put(@cache_key, bundle, @ttl_ms)
              ok

            {:error, _reason} = error ->
              error
          end
      end
    end
  end

  @spec invalidate() :: :ok
  def invalidate, do: HotpathCache.invalidate(@cache_key)

  defp build(fetchers) do
    results =
      fetchers
      |> Task.async_stream(
        fn {_agent, fun} -> fun.() end,
        timeout: @fetch_timeout_ms,
        on_timeout: :kill_task,
        ordered: true,
        max_concurrency: 4
      )
      |> Enum.to_list()

    {agents, failures} =
      fetchers
      |> Enum.zip(results)
      |> Enum.reduce({[], %{}}, fn
        {{_agent, _fun}, {:ok, {:ok, catalog}}}, {agents, failures} when is_map(catalog) ->
          {[catalog | agents], failures}

        {{agent, _fun}, {:ok, {:error, reason}}}, {agents, failures} ->
          {agents, Map.put(failures, agent, reason)}

        {{agent, _fun}, {:exit, reason}}, {agents, failures} ->
          {agents, Map.put(failures, agent, reason)}

        {{agent, _fun}, result}, {agents, failures} ->
          {agents, Map.put(failures, agent, {:invalid_catalog_result, result})}
      end)

    # Provider discovery is independent. A missing local Cursor/OpenCode
    # executable must not prevent the Codex/Claude options already discovered
    # on this Machine from reaching the mobile composer.
    if agents != [] do
      {:ok,
       %{agents: Enum.reverse(agents), default_agent: Settings.Agents.default_agent_kind()}
       |> maybe_put_failures(failures)}
    else
      {:error, {:assistant_catalog_unavailable, failures}}
    end
  end

  defp maybe_put_failures(bundle, failures) when map_size(failures) == 0, do: bundle
  defp maybe_put_failures(bundle, failures), do: Map.put(bundle, :unavailable_agents, failures)

  defp default_fetchers do
    [
      codex: &SymphonyElixir.Codex.ModelCatalog.list_models/0,
      claude: &SymphonyElixir.Claude.ModelCatalog.list_models/0,
      cursor: &SymphonyElixir.Cursor.ModelCatalog.list_models/0,
      opencode: &SymphonyElixir.OpenCode.ModelCatalog.list_models/0
    ]
  end
end
