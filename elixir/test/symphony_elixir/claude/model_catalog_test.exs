defmodule SymphonyElixir.Claude.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.ModelCatalog

  test "static catalog mirrors the codex catalog shape" do
    assert {:ok, catalog} = ModelCatalog.list_models()

    assert catalog.agent == "claude"
    assert catalog.agent_label == "Claude Code"
    assert is_binary(catalog.command)
    assert catalog.default_model == "claude-opus-4-6"

    ids = Enum.map(catalog.models, & &1.id)
    assert ids == ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]

    assert Enum.all?(catalog.models, &(&1.efforts == []))
    assert Enum.find(catalog.models, & &1.is_default).id == "claude-opus-4-6"
  end
end
