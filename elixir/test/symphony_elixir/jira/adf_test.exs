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

  describe "from_text/1 markdown parsing" do
    test "parses headings into heading nodes" do
      assert Adf.from_text("## Title") ==
               doc([
                 %{
                   "type" => "heading",
                   "attrs" => %{"level" => 2},
                   "content" => [%{"type" => "text", "text" => "Title"}]
                 }
               ])
    end

    test "parses bullet lists" do
      assert Adf.from_text("- First\n- Second") ==
               doc([%{"type" => "bulletList", "content" => [list_item("First"), list_item("Second")]}])
    end

    test "parses ordered lists" do
      assert Adf.from_text("1. First\n2. Second") ==
               doc([%{"type" => "orderedList", "content" => [list_item("First"), list_item("Second")]}])
    end

    test "parses nested lists" do
      nested = %{
        "type" => "listItem",
        "content" => [
          paragraph("Parent"),
          %{"type" => "bulletList", "content" => [list_item("Child")]}
        ]
      }

      assert Adf.from_text("- Parent\n  - Child") == doc([%{"type" => "bulletList", "content" => [nested]}])
    end

    test "parses strong and emphasis marks" do
      assert Adf.from_text("**bold** and *italic*") ==
               doc([
                 %{
                   "type" => "paragraph",
                   "content" => [
                     %{"type" => "text", "text" => "bold", "marks" => [%{"type" => "strong"}]},
                     %{"type" => "text", "text" => " and "},
                     %{"type" => "text", "text" => "italic", "marks" => [%{"type" => "em"}]}
                   ]
                 }
               ])
    end

    test "parses inline code and strikethrough" do
      assert Adf.from_text("`run()` ~~gone~~") ==
               doc([
                 %{
                   "type" => "paragraph",
                   "content" => [
                     %{"type" => "text", "text" => "run()", "marks" => [%{"type" => "code"}]},
                     %{"type" => "text", "text" => " "},
                     %{"type" => "text", "text" => "gone", "marks" => [%{"type" => "strike"}]}
                   ]
                 }
               ])
    end

    test "parses links as link marks" do
      assert Adf.from_text("[Civitas](https://x.test)") ==
               doc([
                 %{
                   "type" => "paragraph",
                   "content" => [
                     %{
                       "type" => "text",
                       "text" => "Civitas",
                       "marks" => [%{"type" => "link", "attrs" => %{"href" => "https://x.test"}}]
                     }
                   ]
                 }
               ])
    end

    test "parses hard breaks from trailing double spaces" do
      assert Adf.from_text("line one  \nline two") ==
               doc([
                 %{
                   "type" => "paragraph",
                   "content" => [
                     %{"type" => "text", "text" => "line one"},
                     %{"type" => "hardBreak"},
                     %{"type" => "text", "text" => "line two"}
                   ]
                 }
               ])
    end

    test "parses fenced code blocks with language" do
      assert Adf.from_text("```elixir\nIO.puts(1)\n```") ==
               doc([
                 %{
                   "type" => "codeBlock",
                   "attrs" => %{"language" => "elixir"},
                   "content" => [%{"type" => "text", "text" => "IO.puts(1)"}]
                 }
               ])
    end

    test "parses block quotes" do
      assert Adf.from_text("> quoted") == doc([%{"type" => "blockquote", "content" => [paragraph("quoted")]}])
    end

    test "parses horizontal rules" do
      assert Adf.from_text("---") == doc([%{"type" => "rule"}])
    end

    test "parses GitHub-flavored tables" do
      markdown = "| First Name | Last Name |\n| --- | --- |\n| Ada | Lovelace |"

      assert Adf.from_text(markdown) ==
               doc([
                 %{
                   "type" => "table",
                   "content" => [
                     %{"type" => "tableRow", "content" => [table_cell("First Name"), table_cell("Last Name")]},
                     %{"type" => "tableRow", "content" => [table_cell("Ada"), table_cell("Lovelace")]}
                   ]
                 }
               ])
    end

    test "round-trips structured markdown through to_text" do
      markdown = "# Scope\n\nIntro line.\n\n- One\n- Two"

      assert markdown |> Adf.from_text() |> Adf.to_text() == markdown
    end

    test "parses workpad-style headings without leaving markdown markers as text" do
      doc = Adf.from_text("## Codex Workpad\n\n- plan item")

      assert get_in(doc, ["content", Access.at(0), "type"]) == "heading"
      assert get_in(doc, ["content", Access.at(0), "content", Access.at(0), "text"]) == "Codex Workpad"
      refute get_in(doc, ["content", Access.at(0), "content", Access.at(0), "text"]) =~ "##"
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

  describe "to_text/1 markdown formatting" do
    test "renders headings with leading hashes" do
      doc =
        doc([
          %{
            "type" => "heading",
            "attrs" => %{"level" => 2},
            "content" => [%{"type" => "text", "text" => "Title"}]
          }
        ])

      assert Adf.to_text(doc) == "## Title"
    end

    test "renders bullet lists with dashes" do
      doc = doc([%{"type" => "bulletList", "content" => [list_item("First"), list_item("Second")]}])

      assert Adf.to_text(doc) == "- First\n- Second"
    end

    test "renders ordered lists with incrementing numbers" do
      doc = doc([%{"type" => "orderedList", "content" => [list_item("First"), list_item("Second")]}])

      assert Adf.to_text(doc) == "1. First\n2. Second"
    end

    test "indents nested lists" do
      nested = %{
        "type" => "listItem",
        "content" => [
          paragraph("Parent"),
          %{"type" => "bulletList", "content" => [list_item("Child")]}
        ]
      }

      doc = doc([%{"type" => "bulletList", "content" => [nested]}])

      assert Adf.to_text(doc) == "- Parent\n  - Child"
    end

    test "applies strong and emphasis marks" do
      doc =
        doc([
          %{
            "type" => "paragraph",
            "content" => [
              %{"type" => "text", "text" => "bold", "marks" => [%{"type" => "strong"}]},
              %{"type" => "text", "text" => " and "},
              %{"type" => "text", "text" => "italic", "marks" => [%{"type" => "em"}]}
            ]
          }
        ])

      assert Adf.to_text(doc) == "**bold** and *italic*"
    end

    test "renders inline code and strikethrough marks" do
      doc =
        doc([
          %{
            "type" => "paragraph",
            "content" => [
              %{"type" => "text", "text" => "run()", "marks" => [%{"type" => "code"}]},
              %{"type" => "text", "text" => " "},
              %{"type" => "text", "text" => "gone", "marks" => [%{"type" => "strike"}]}
            ]
          }
        ])

      assert Adf.to_text(doc) == "`run()` ~~gone~~"
    end

    test "renders links as markdown" do
      doc =
        doc([
          %{
            "type" => "paragraph",
            "content" => [
              %{
                "type" => "text",
                "text" => "Civitas",
                "marks" => [%{"type" => "link", "attrs" => %{"href" => "https://x.test"}}]
              }
            ]
          }
        ])

      assert Adf.to_text(doc) == "[Civitas](https://x.test)"
    end

    test "hard breaks split lines within a paragraph" do
      doc =
        doc([
          %{
            "type" => "paragraph",
            "content" => [
              %{"type" => "text", "text" => "line one"},
              %{"type" => "hardBreak"},
              %{"type" => "text", "text" => "line two"}
            ]
          }
        ])

      assert Adf.to_text(doc) == "line one  \nline two"
    end

    test "renders fenced code blocks with language" do
      doc =
        doc([
          %{
            "type" => "codeBlock",
            "attrs" => %{"language" => "elixir"},
            "content" => [%{"type" => "text", "text" => "IO.puts(1)"}]
          }
        ])

      assert Adf.to_text(doc) == "```elixir\nIO.puts(1)\n```"
    end

    test "renders block quotes with a prefix" do
      doc = doc([%{"type" => "blockquote", "content" => [paragraph("quoted")]}])

      assert Adf.to_text(doc) == "> quoted"
    end

    test "renders horizontal rules" do
      assert Adf.to_text(doc([%{"type" => "rule"}])) == "---"
    end

    test "renders tables as GitHub-flavored markdown" do
      doc =
        doc([
          %{
            "type" => "table",
            "content" => [
              %{"type" => "tableRow", "content" => [table_cell("First Name"), table_cell("Last Name")]},
              %{"type" => "tableRow", "content" => [table_cell("Ada"), table_cell("Lovelace")]}
            ]
          }
        ])

      assert Adf.to_text(doc) ==
               "| First Name | Last Name |\n| --- | --- |\n| Ada | Lovelace |"
    end

    test "renders mentions as their display text" do
      doc = doc([%{"type" => "paragraph", "content" => [%{"type" => "mention", "attrs" => %{"text" => "@Raphael"}}]}])

      assert Adf.to_text(doc) == "@Raphael"
    end

    test "separates a heading, paragraph and list with blank lines" do
      doc =
        doc([
          %{"type" => "heading", "attrs" => %{"level" => 1}, "content" => [%{"type" => "text", "text" => "Scope"}]},
          paragraph("Intro line."),
          %{"type" => "bulletList", "content" => [list_item("One"), list_item("Two")]}
        ])

      assert Adf.to_text(doc) == "# Scope\n\nIntro line.\n\n- One\n- Two"
    end
  end

  defp doc(content), do: %{"type" => "doc", "version" => 1, "content" => content}

  defp paragraph(text), do: %{"type" => "paragraph", "content" => [%{"type" => "text", "text" => text}]}

  defp list_item(text), do: %{"type" => "listItem", "content" => [paragraph(text)]}

  defp table_cell(text), do: %{"type" => "tableCell", "content" => [paragraph(text)]}
end
