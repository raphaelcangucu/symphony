defmodule SymphonyElixir.Cursor.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.ModelCatalog

  test "static catalog mirrors the codex catalog shape" do
    assert {:ok, catalog} = ModelCatalog.list_models()

    assert catalog.agent == "cursor"
    assert catalog.agent_label == "Cursor Agent"
    assert is_binary(catalog.command)
    assert catalog.default_model == "auto"

    ids = Enum.map(catalog.models, & &1.id)
    assert "auto" in ids
    assert Enum.find(catalog.models, & &1.is_default).id == "auto"
  end

  test "the cursor-agent CLI has no effort control, so every model hides the menu" do
    assert {:ok, catalog} = ModelCatalog.list_models()

    Enum.each(catalog.models, fn model ->
      assert model.efforts == []
      assert model.default_effort == ""
    end)
  end
end
