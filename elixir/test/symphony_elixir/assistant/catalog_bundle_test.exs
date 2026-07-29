defmodule SymphonyElixir.Assistant.CatalogBundleTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.CatalogBundle

  test "returns available provider catalogs while reporting an unavailable provider" do
    assert {:ok, bundle} =
             CatalogBundle.fetch(
               fetchers: [
                 codex: fn -> {:ok, catalog("codex")} end,
                 cursor: fn -> {:error, :cli_unavailable} end
               ]
             )

    assert Enum.map(bundle.agents, & &1.agent) == ["codex"]
    assert bundle.unavailable_agents == %{cursor: :cli_unavailable}
  end

  test "returns an explicit error when every provider catalog is unavailable" do
    assert {:error, {:assistant_catalog_unavailable, %{codex: :cli_unavailable}}} =
             CatalogBundle.fetch(fetchers: [codex: fn -> {:error, :cli_unavailable} end])
  end

  test "returns all successful catalogs as one bundle" do
    assert {:ok, bundle} =
             CatalogBundle.fetch(
               fetchers: [
                 codex: fn -> {:ok, catalog("codex")} end,
                 cursor: fn -> {:ok, catalog("cursor")} end
               ]
             )

    assert Enum.map(bundle.agents, & &1.agent) == ["codex", "cursor"]
  end

  defp catalog(agent) do
    %{
      agent: agent,
      agent_label: String.capitalize(agent),
      command: agent,
      default_model: "#{agent}-model",
      models: [
        %{
          id: "#{agent}-model",
          model: "#{agent}-model",
          label: "#{agent}-model",
          is_default: true,
          default_effort: "",
          efforts: []
        }
      ]
    }
  end
end
