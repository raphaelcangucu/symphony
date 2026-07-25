defmodule SymphonyElixir.Codex.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Codex.ModelCatalog

  test "returns the CLI discovery error when no trustworthy cache exists" do
    assert {:error, :codex_catalog_unavailable} =
             ModelCatalog.list_models(
               fresh: true,
               fetch_fun: fn -> {:error, :codex_catalog_unavailable} end
             )
  end
end
