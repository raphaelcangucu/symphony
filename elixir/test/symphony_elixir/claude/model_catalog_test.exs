defmodule SymphonyElixir.Claude.ModelCatalogTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.ModelCatalog

  test "static catalog mirrors the codex catalog shape" do
    assert {:ok, catalog} = ModelCatalog.list_models()

    assert catalog.agent == "claude"
    assert catalog.agent_label == "Claude Code"
    assert is_binary(catalog.command)
    assert catalog.default_model == "claude-opus-4-8"

    ids = Enum.map(catalog.models, & &1.id)

    assert ids == [
             "claude-opus-4-8",
             "claude-fable-5",
             "claude-opus-4-7",
             "claude-opus-4-6",
             "claude-sonnet-5",
             "claude-sonnet-4-6",
             "claude-haiku-4-5"
           ]

    assert Enum.find(catalog.models, & &1.is_default).id == "claude-opus-4-8"
  end

  test "exposes reasoning efforts per model with Claude Code's default rung" do
    assert {:ok, catalog} = ModelCatalog.list_models()
    by_id = Map.new(catalog.models, &{&1.id, &1})

    # Opus 4.7+ carries the full effort ladder, including xhigh and the
    # flagship-only max rung, and defaults to xhigh like Claude Code itself.
    opus = by_id["claude-opus-4-8"]
    assert Enum.map(opus.efforts, & &1.id) == ["low", "medium", "high", "xhigh", "max"]
    assert opus.default_effort == "xhigh"
    assert %{id: "xhigh", label: "Extra high"} in opus.efforts

    # Fable 5 is flagship-tier: same full ladder as Opus (including max) and the
    # same xhigh default.
    fable = by_id["claude-fable-5"]
    assert Enum.map(fable.efforts, & &1.id) == ["low", "medium", "high", "xhigh", "max"]
    assert fable.default_effort == "xhigh"

    # Opus 4.6 predates xhigh but still supports the flagship-only max rung, so
    # it falls back to the GA default high.
    opus_legacy = by_id["claude-opus-4-6"]
    assert Enum.map(opus_legacy.efforts, & &1.id) == ["low", "medium", "high", "max"]
    assert opus_legacy.default_effort == "high"

    # Sonnet 5 gained xhigh but has no max rung, and still defaults to high — so
    # the default is pinned explicitly rather than inferred from the ladder.
    sonnet_next = by_id["claude-sonnet-5"]
    assert Enum.map(sonnet_next.efforts, & &1.id) == ["low", "medium", "high", "xhigh"]
    assert sonnet_next.default_effort == "high"

    # Sonnet 4.6 supports effort but neither the flagship-only max nor xhigh rungs.
    sonnet = by_id["claude-sonnet-4-6"]
    assert Enum.map(sonnet.efforts, & &1.id) == ["low", "medium", "high"]
    assert sonnet.default_effort == "high"

    # Haiku has no effort control — empty efforts keep the composer menu hidden.
    haiku = by_id["claude-haiku-4-5"]
    assert haiku.efforts == []
    assert haiku.default_effort == ""
  end
end
