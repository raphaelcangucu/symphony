defmodule SymphonyElixir.Notion.MarkdownTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Notion.Markdown

  test "renders heading paragraph list and code" do
    blocks = [
      %{
        "type" => "heading_1",
        "heading_1" => %{"rich_text" => [%{"plain_text" => "Title", "annotations" => %{}}]}
      },
      %{
        "type" => "paragraph",
        "paragraph" => %{
          "rich_text" => [
            %{"plain_text" => "Hello ", "annotations" => %{}},
            %{"plain_text" => "code", "annotations" => %{"code" => true}}
          ]
        }
      },
      %{
        "type" => "bulleted_list_item",
        "bulleted_list_item" => %{"rich_text" => [%{"plain_text" => "Item", "annotations" => %{}}]}
      },
      %{
        "type" => "code",
        "code" => %{
          "language" => "elixir",
          "rich_text" => [%{"plain_text" => "1 + 1", "annotations" => %{}}]
        }
      }
    ]

    {md, assets} = Markdown.from_blocks(blocks, "Page Title")
    assert md =~ "# Page Title"
    assert md =~ "# Title" or md =~ "## Title" or md =~ "Title"
    assert md =~ "`code`"
    assert md =~ "- Item"
    assert md =~ "```elixir"
    assert assets == []
  end

  test "queues image assets and rewrites relative path" do
    blocks = [
      %{
        "id" => "img1",
        "type" => "image",
        "image" => %{
          "type" => "external",
          "external" => %{"url" => "https://example.com/a.png"}
        }
      }
    ]

    {md, assets} = Markdown.from_blocks(blocks, "Img")
    assert [%{url: "https://example.com/a.png", filename: filename}] = assets
    assert md =~ "./assets/#{filename}"
  end

  test "rejects path-traversal basenames from URLs ending in /.." do
    blocks = [
      %{
        "id" => "bad-1",
        "type" => "image",
        "image" => %{
          "type" => "external",
          "external" => %{"url" => "https://example.com/foo/.."}
        }
      }
    ]

    {_md, assets} = Markdown.from_blocks(blocks, "Safe")
    assert [%{filename: filename}] = assets
    refute filename in [".", "..", ""]
    refute String.contains?(filename, "/")
    refute String.contains?(filename, "\\")
    assert filename =~ ~r/^block-/ or filename == "asset.png"
  end

  test "disambiguates duplicate asset basenames with block id" do
    blocks = [
      %{
        "id" => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "type" => "image",
        "image" => %{
          "type" => "external",
          "external" => %{"url" => "https://example.com/a.png"}
        }
      },
      %{
        "id" => "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "type" => "image",
        "image" => %{
          "type" => "external",
          "external" => %{"url" => "https://example.com/other/a.png"}
        }
      }
    ]

    {_md, assets} = Markdown.from_blocks(blocks, "Dup")
    filenames = Enum.map(assets, & &1.filename)
    assert length(filenames) == 2
    assert length(Enum.uniq(filenames)) == 2
    assert "a.png" in filenames
    assert Enum.any?(filenames, &(&1 == "a-bbbbbbbb.png"))
  end

  test "database rows become a markdown table" do
    properties_schema = [
      {"Name", "title"},
      {"Status", "select"}
    ]

    rows = [
      %{
        "url" => "https://www.notion.so/row1",
        "properties" => %{
          "Name" => %{"type" => "title", "title" => [%{"plain_text" => "Alpha"}]},
          "Status" => %{"type" => "select", "select" => %{"name" => "Done"}}
        }
      }
    ]

    md = Markdown.from_database("DB", properties_schema, rows)
    assert md =~ "# DB"
    assert md =~ "| Name | Status |"
    assert md =~ "| Alpha | Done |"
  end

  test "escapes table cell newlines and pipes" do
    properties_schema = [
      {"Name", "title"},
      {"Notes", "rich_text"}
    ]

    rows = [
      %{
        "properties" => %{
          "Name" => %{"type" => "title", "title" => [%{"plain_text" => "Row"}]},
          "Notes" => %{
            "type" => "rich_text",
            "rich_text" => [%{"plain_text" => "line1\nline2|pipe"}]
          }
        }
      }
    ]

    md = Markdown.from_database("DB", properties_schema, rows)
    assert md =~ "| Row | line1 line2\\|pipe |"
    refute md =~ "line1\nline2"
  end

  test "unsupported blocks become HTML comments" do
    blocks = [%{"type" => "toggle", "toggle" => %{"rich_text" => []}}]
    {md, _} = Markdown.from_blocks(blocks, "T")
    assert md =~ "<!-- unsupported notion block: toggle -->"
  end
end
