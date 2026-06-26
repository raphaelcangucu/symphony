defmodule SymphonyElixir.KnowledgeBase.PathsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Paths

  describe "repo_slug/1 and workspace_path_from_slug/1" do
    test "round-trips nested workspace paths" do
      assert Paths.repo_slug("acme/web") == "acme~web"
      assert Paths.workspace_path_from_slug("acme~web") == "acme/web"
    end

    test "leaves single-segment paths unchanged" do
      assert Paths.repo_slug("backend") == "backend"
      assert Paths.workspace_path_from_slug("backend") == "backend"
    end
  end

  describe "safe_relative_path/1" do
    test "accepts a nested markdown path from segments" do
      assert Paths.safe_relative_path(["architecture", "backend.md"]) ==
               {:ok, "architecture/backend.md"}
    end

    test "accepts a markdown path from a string" do
      assert Paths.safe_relative_path("index.md") == {:ok, "index.md"}
    end

    test "rejects parent traversal, empty segments, and non-markdown leaves" do
      assert Paths.safe_relative_path(["..", "secrets.md"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path(["a", "", "b.md"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path(["notes.txt"]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path([]) == {:error, :kb_invalid_path}
      assert Paths.safe_relative_path("/etc/passwd.md") == {:error, :kb_invalid_path}
    end
  end

  describe "resolve_page/3" do
    test "resolves a page inside the repo docs root" do
      {:ok, full} = Paths.resolve_page("proj", "web", ["guide.md"])
      assert String.ends_with?(full, "/proj/web/docs/guide.md")
    end

    test "rejects traversal even if it would escape docs root" do
      assert Paths.resolve_page("proj", "web", ["..", "..", "x.md"]) ==
               {:error, :kb_invalid_path}
    end
  end

  describe "safe_asset_relative_path/1" do
    test "accepts assets under docs/assets" do
      assert Paths.safe_asset_relative_path(["assets", "logo.png"]) == {:ok, "assets/logo.png"}
    end

    test "accepts image files elsewhere under docs" do
      assert Paths.safe_asset_relative_path(["images", "diagram.png"]) == {:ok, "images/diagram.png"}
    end

    test "rejects non-image paths outside assets" do
      assert Paths.safe_asset_relative_path(["notes.txt"]) == {:error, :kb_invalid_path}
    end
  end
end
