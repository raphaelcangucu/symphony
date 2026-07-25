defmodule SymphonyElixir.Assistant.CatalogBundleTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.CatalogBundle

  test "returns an explicit provider error instead of omitting a failed catalog" do
    assert {:error, {:assistant_catalog_unavailable, failures}} =
             CatalogBundle.fetch(
               fetchers: [
                 codex: fn -> {:ok, catalog("codex")} end,
                 cursor: fn -> {:error, :cli_unavailable} end
               ]
             )

    assert failures == %{cursor: :cli_unavailable}
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
