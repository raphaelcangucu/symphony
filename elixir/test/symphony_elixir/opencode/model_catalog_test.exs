defmodule SymphonyElixir.OpenCode.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.OpenCode.ModelCatalog

  test "parses provider/model lines from CLI output" do
    stub = fn ->
      {"Models cache refreshed\nanthropic/claude-sonnet-4-6\nopencode/gpt-5.5\n", 0}
    end

    assert {:ok, catalog} = ModelCatalog.list_models(list_models_fun: stub)
    ids = Enum.map(catalog.models, & &1.id)
    assert "anthropic/claude-sonnet-4-6" in ids
    assert "opencode/gpt-5.5" in ids
    assert catalog.agent == "opencode"
    assert catalog.agent_label == "OpenCode"
  end

  test "falls back to static catalog when CLI fails" do
    stub = fn -> {"error", 1} end

    assert {:ok, catalog} = ModelCatalog.list_models(list_models_fun: stub)
    assert length(catalog.models) >= 1
    assert Enum.any?(catalog.models, & &1.is_default)
  end
end
