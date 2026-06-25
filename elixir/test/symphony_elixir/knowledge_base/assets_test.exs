defmodule SymphonyElixir.KnowledgeBase.AssetsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Assets

  test "validate accepts allowed image extensions within the size limit" do
    assert Assets.validate("logo.png", 1_000) == {:ok, ".png"}
    assert Assets.validate("photo.JPG", 1_000) == {:ok, ".jpg"}
  end

  test "validate rejects unsupported types and oversized files" do
    assert Assets.validate("notes.exe", 10) == {:error, :kb_unsupported_asset}
    assert Assets.validate("logo.png", 5 * 1024 * 1024) == {:error, :kb_asset_too_large}
  end

  test "content_name produces a deterministic sha256 filename" do
    name = Assets.content_name(<<1, 2, 3>>, ".png")
    assert name == Assets.content_name(<<1, 2, 3>>, ".png")
    assert String.ends_with?(name, ".png")
    assert byte_size(name) == 64 + 4
  end

  test "relative_link builds a path from the page to the asset" do
    assert Assets.relative_link("architecture/backend.md", "assets/ab.png") == "../assets/ab.png"
    assert Assets.relative_link("index.md", "assets/ab.png") == "assets/ab.png"
  end
end
