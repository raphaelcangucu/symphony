defmodule SymphonyElixir.Cursor.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.ModelCatalog

  @sample_cli_output """
  Available models

  auto - Auto
  composer-2.5 - Composer 2.5 (current)
  composer-2.5-fast - Composer 2.5 Fast (default)
  claude-opus-4-8-high - Opus 4.8 1M
  gpt-5.5-high - GPT-5.5 1M High
  """

  defp stub_cli(output, status \\ 0) do
    fn -> {output, status} end
  end

  test "catalog mirrors the codex catalog shape" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    assert catalog.agent == "cursor"
    assert catalog.agent_label == "Cursor Agent"
    assert is_binary(catalog.command)
    assert catalog.default_model == "auto"
  end

  test "parses the slug and label from each --list-models line" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    by_id = Map.new(catalog.models, &{&1.id, &1})

    assert by_id["composer-2.5"].label == "Composer 2.5 (current)"
    assert by_id["claude-opus-4-8-high"].label == "Opus 4.8 1M"
    assert by_id["gpt-5.5-high"].label == "GPT-5.5 1M High"
  end

  test "exposes the newer models the CLI reports, not the old static five" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    ids = Enum.map(catalog.models, & &1.id)

    assert "composer-2.5" in ids
    assert "claude-opus-4-8-high" in ids
    assert "gpt-5.5-high" in ids
  end

  test "marks auto as the default model" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    assert Enum.find(catalog.models, & &1.is_default).id == "auto"
  end

  test "the cursor-agent CLI has no effort control, so every model hides the menu" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    Enum.each(catalog.models, fn model ->
      assert model.efforts == []
      assert model.default_effort == ""
    end)
  end

  test "ignores the header and any blank lines in the CLI output" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli(@sample_cli_output))

    ids = Enum.map(catalog.models, & &1.id)
    refute "Available" in ids
    refute "" in ids
  end

  test "falls back to the static catalog when the CLI fails" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli("boom", 1))

    ids = Enum.map(catalog.models, & &1.id)
    assert "auto" in ids
    assert Enum.find(catalog.models, & &1.is_default).id == "auto"
    assert catalog.default_model == "auto"
  end

  test "falls back to the static catalog when the CLI emits no model lines" do
    assert {:ok, catalog} =
             ModelCatalog.list_models(list_models_fun: stub_cli("Available models\n"))

    ids = Enum.map(catalog.models, & &1.id)
    assert "auto" in ids
  end
end
