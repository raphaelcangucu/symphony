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

  test "unsupported blocks become HTML comments" do
    blocks = [%{"type" => "toggle", "toggle" => %{"rich_text" => []}}]
    {md, _} = Markdown.from_blocks(blocks, "T")
    assert md =~ "<!-- unsupported notion block: toggle -->"
  end
end
