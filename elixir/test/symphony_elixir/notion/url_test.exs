defmodule SymphonyElixir.Notion.UrlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Notion.Url

  test "parses bare 32-hex UUID in path" do
    assert {:ok, %{id: "39c33f2e-afc1-4020-ac9b-c223b4520d17", focused_page_id: nil}} =
             Url.parse("https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17")
  end

  test "parses hyphenated UUID in path" do
    assert {:ok, %{id: "39c33f2e-afc1-4020-ac9b-c223b4520d17", focused_page_id: nil}} =
             Url.parse("https://www.notion.so/39c33f2e-afc1-4020-ac9b-c223b4520d17")
  end

  test "parses 32-hex suffix after title slug" do
    assert {:ok, %{id: "ba15679b-2eb3-4182-a336-57d314df88e0", focused_page_id: nil}} =
             Url.parse("https://www.notion.so/gambalabs/Gamba-Tasks-ba15679b2eb34182a33657d314df88e0")
  end

  test "prefers p= query as focused page id" do
    url =
      "https://www.notion.so/p/gambalabs/ba15679b2eb34182a33657d314df88e0" <>
        "?v=972633e9a0504d53bca2a99289003bd7&p=39c33f2eafc14020ac9bc223b4520d17&pm=s"

    assert {:ok,
            %{
              id: "ba15679b-2eb3-4182-a336-57d314df88e0",
              focused_page_id: "39c33f2e-afc1-4020-ac9b-c223b4520d17"
            }} = Url.parse(url)
  end

  test "rejects non-notion hosts" do
    assert {:error, :invalid_notion_url} = Url.parse("https://example.com/foo")
  end
end
