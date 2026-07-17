defmodule SymphonyElixir.Assistant.NotionToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.NotionTools
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.{Credentials, Setting}

  setup do
    Repo.delete_all(Setting)
    previous = System.get_env("NOTION_API_KEY")

    on_exit(fn ->
      Repo.delete_all(Setting)

      if previous,
        do: System.put_env("NOTION_API_KEY", previous),
        else: System.delete_env("NOTION_API_KEY")
    end)

    System.delete_env("NOTION_API_KEY")
    :ok
  end

  test "tool_specs includes import_notion_page with required url" do
    [spec] = NotionTools.tool_specs()
    assert spec["name"] == "import_notion_page"
    assert spec["inputSchema"]["required"] == ["url"]
  end

  test "missing api key" do
    assert {:error, :missing_api_key} =
             NotionTools.execute(
               "import_notion_page",
               %{"url" => "https://www.notion.so/" <> String.duplicate("a", 32)},
               []
             )
  end

  test "invalid url with key configured" do
    assert {:ok, :stored} = Credentials.put("notion", "api_key", "tok")

    assert {:error, :invalid_notion_url} =
             NotionTools.execute("import_notion_page", %{"url" => "https://example.com"}, [])
  end
end
