defmodule SymphonyElixir.Tracker.DisplayIdentifierTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.DisplayIdentifier

  describe "resolve/3 — external URL wins" do
    test "GitHub issue URL rebuilds repo#number even when identifier lost its prefix" do
      assert DisplayIdentifier.resolve("537", "https://github.com/clouapp/front/issues/537") ==
               "front#537"
    end

    test "GitHub URL is idempotent for an already-prefixed identifier" do
      assert DisplayIdentifier.resolve("back#288", "https://github.com/clouapp/back/issues/288") ==
               "back#288"
    end

    test "Jira browse URL returns the uppercased issue key" do
      assert DisplayIdentifier.resolve("CDE-1132", "https://acme.atlassian.net/browse/cde-1132") ==
               "CDE-1132"
    end

    test "Linear issue URL returns the issue identifier" do
      assert DisplayIdentifier.resolve("MAC-1", "https://linear.app/acme/issue/MAC-1/some-title") ==
               "MAC-1"
    end

    test "URL takes precedence over the repository fallback" do
      assert DisplayIdentifier.resolve(
               "537",
               "https://github.com/clouapp/back/issues/537",
               "clouapp/front"
             ) == "back#537"
    end
  end

  describe "resolve/3 — fallback to canonical identifier" do
    test "no external URL keeps the local MAC-N identifier (unreconciled)" do
      assert DisplayIdentifier.resolve("MAC-1", nil) == "MAC-1"
    end

    test "blank URL keeps the canonical identifier" do
      assert DisplayIdentifier.resolve("MAC-7", "   ") == "MAC-7"
    end

    test "unrecognized host keeps the canonical identifier" do
      assert DisplayIdentifier.resolve("MAC-3", "https://example.com/whatever/42") == "MAC-3"
    end

    test "malformed GitHub URL with no issue number keeps the canonical identifier" do
      assert DisplayIdentifier.resolve("MAC-1", "https://github.com/o/r/issues/") == "MAC-1"
    end

    test "trims surrounding whitespace from the canonical identifier" do
      assert DisplayIdentifier.resolve("  MAC-2  ", nil) == "MAC-2"
    end
  end

  describe "resolve/3 — repository fallback (URL absent)" do
    test "rebuilds repo#number from repository_full_name for a numeric identifier" do
      assert DisplayIdentifier.resolve("537", nil, "clouapp/front") == "front#537"
    end

    test "ignores repository fallback for a non-numeric identifier" do
      assert DisplayIdentifier.resolve("MAC-1", nil, "clouapp/front") == "MAC-1"
    end

    test "ignores blank repository_full_name" do
      assert DisplayIdentifier.resolve("537", nil, "") == "537"
    end
  end
end
