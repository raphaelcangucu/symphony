defmodule SymphonyElixir.Jira.AdfTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.Adf

  describe "from_text/1" do
    test "wraps plain text in a single-paragraph ADF doc" do
      assert Adf.from_text("hello") == %{
               "type" => "doc",
               "version" => 1,
               "content" => [
                 %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "hello"}]}
               ]
             }
    end

    test "splits on blank lines into multiple paragraphs" do
      doc = Adf.from_text("a\n\nb")

      assert doc["content"] == [
               %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "a"}]},
               %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "b"}]}
             ]
    end

    test "nil yields an empty doc" do
      assert Adf.from_text(nil) == %{"type" => "doc", "version" => 1, "content" => []}
    end

    test "empty string yields an empty doc" do
      assert Adf.from_text("")["content"] == []
    end

    test "collapses runs of blank lines" do
      assert length(Adf.from_text("a\n\n\n\nb")["content"]) == 2
    end
  end

  describe "to_text/1" do
    test "flattens nested ADF text nodes with paragraph breaks" do
      doc = %{
        "type" => "doc",
        "content" => [
          %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "a"}]},
          %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "b"}]}
        ]
      }

      assert Adf.to_text(doc) == "a\n\nb"
    end

    test "concatenates multiple inline text nodes within a paragraph" do
      doc = %{
        "type" => "doc",
        "content" => [
          %{
            "type" => "paragraph",
            "content" => [
              %{"type" => "text", "text" => "hello "},
              %{"type" => "text", "text" => "world"}
            ]
          }
        ]
      }

      assert Adf.to_text(doc) == "hello world"
    end

    test "nil returns empty string" do
      assert Adf.to_text(nil) == ""
    end

    test "already-plain string is returned unchanged" do
      assert Adf.to_text("already plain") == "already plain"
    end

    test "round-trips plain text" do
      text = "first paragraph\n\nsecond paragraph"
      assert text |> Adf.from_text() |> Adf.to_text() == text
    end
  end
end
