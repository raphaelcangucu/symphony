defmodule SymphonyElixir.Notion.ImporterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Notion.Importer
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @page_id "39c33f2e-afc1-4020-ac9b-c223b4520d17"
  @db_id "ba15679b-2eb3-4182-a336-57d314df88e0"

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

  test "imports a page into tmp and returns paths" do
    http = fn method, url, _opts ->
      cond do
        method == :get and String.contains?(url, "/v1/pages/") ->
          {:ok, 200,
           %{
             "object" => "page",
             "id" => @page_id,
             "properties" => %{
               "title" => %{"type" => "title", "title" => [%{"plain_text" => "Marble Race"}]}
             },
             "url" => "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17"
           }}

        method == :get and String.contains?(url, "/v1/blocks/") ->
          {:ok, 200,
           %{
             "results" => [
               %{
                 "type" => "paragraph",
                 "paragraph" => %{
                   "rich_text" => [%{"plain_text" => "Hello", "annotations" => %{}}]
                 }
               }
             ],
             "has_more" => false
           }}

        true ->
          flunk("unexpected request: #{method} #{url}")
      end
    end

    assert {:ok, result} =
             Importer.import_url(
               "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17",
               api_key: "k",
               http: http
             )

    assert result.kind == "page"
    assert result.title =~ "Marble"
    assert File.exists?(result.markdown_path)
    assert File.exists?(result.meta_path)
    assert File.exists?(result.assets_dir)
    assert File.read!(result.markdown_path) =~ "Hello"
    assert is_binary(result.import_id)
    assert result.preview_markdown =~ "Hello"
    assert result.warnings == []
    assert result.asset_count == 0
  end

  test "uses focused_page_id from p= when present" do
    focused = @page_id
    db = @db_id

    http = fn method, url, _opts ->
      cond do
        method == :get and String.contains?(url, "/v1/pages/#{focused}") ->
          {:ok, 200,
           %{
             "object" => "page",
             "id" => focused,
             "properties" => %{
               "title" => %{"type" => "title", "title" => [%{"plain_text" => "Focused"}]}
             },
             "url" => "https://www.notion.so/#{String.replace(focused, "-", "")}"
           }}

        method == :get and String.contains?(url, "/v1/blocks/#{focused}") ->
          {:ok, 200, %{"results" => [], "has_more" => false}}

        true ->
          flunk("unexpected request: #{url} (db id #{db} must not be fetched as page body)")
      end
    end

    url =
      "https://www.notion.so/p/ws/#{String.replace(db, "-", "")}" <>
        "?p=#{String.replace(focused, "-", "")}"

    assert {:ok, result} = Importer.import_url(url, api_key: "k", http: http)
    assert result.title == "Focused"
    assert result.kind == "page"
  end

  test "missing api_key returns missing_api_key" do
    assert {:error, :missing_api_key} =
             Importer.import_url("https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17")
  end

  test "invalid URL returns invalid_notion_url" do
    assert {:error, :invalid_notion_url} =
             Importer.import_url("https://example.com/not-notion", api_key: "k")
  end

  test "continues import when asset download fails and records warning" do
    asset_url = "https://cdn.example.com/photo.png"

    http = fn method, url, _opts ->
      cond do
        method == :get and String.contains?(url, "/v1/pages/") ->
          {:ok, 200,
           %{
             "object" => "page",
             "id" => @page_id,
             "properties" => %{
               "title" => %{"type" => "title", "title" => [%{"plain_text" => "With Image"}]}
             },
             "url" => "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17"
           }}

        method == :get and String.contains?(url, "/v1/blocks/") ->
          {:ok, 200,
           %{
             "results" => [
               %{
                 "id" => "img-block-1",
                 "type" => "image",
                 "image" => %{
                   "type" => "external",
                   "external" => %{"url" => asset_url}
                 }
               }
             ],
             "has_more" => false
           }}

        method == :get and url == asset_url ->
          {:error, :timeout}

        true ->
          flunk("unexpected request: #{method} #{url}")
      end
    end

    assert {:ok, result} =
             Importer.import_url(
               "https://www.notion.so/39c33f2eafc14020ac9bc223b4520d17",
               api_key: "k",
               http: http
             )

    assert result.kind == "page"
    assert File.exists?(result.markdown_path)
    assert File.read!(result.markdown_path) =~ "./assets/photo.png"
    refute File.exists?(Path.join(result.assets_dir, "photo.png"))
    assert result.asset_count == 0
    assert Enum.any?(result.warnings, &String.contains?(&1, "photo.png"))
    assert Enum.any?(result.warnings, &String.contains?(&1, "Failed to download"))

    meta = result.meta_path |> File.read!() |> Jason.decode!()
    assert Enum.any?(meta["warnings"], &String.contains?(&1, "Failed to download"))
  end

  test "imports a database table and warns when truncated" do
    rows =
      for i <- 1..100 do
        %{
          "properties" => %{
            "Name" => %{"type" => "title", "title" => [%{"plain_text" => "Row#{i}"}]},
            "Status" => %{"type" => "select", "select" => %{"name" => "Open"}}
          }
        }
      end

    http = fn method, url, _opts ->
      cond do
        method == :get and String.contains?(url, "/v1/pages/") ->
          {:ok, 404, %{"message" => "Not a page"}}

        method == :get and String.contains?(url, "/v1/databases/#{@db_id}") ->
          {:ok, 200,
           %{
             "object" => "database",
             "id" => @db_id,
             "title" => [%{"plain_text" => "Tasks"}],
             "properties" => %{
               "Name" => %{"type" => "title", "title" => %{}},
               "Status" => %{"type" => "select", "select" => %{}}
             }
           }}

        method == :post and String.contains?(url, "/v1/databases/#{@db_id}/query") ->
          {:ok, 200,
           %{
             "results" => rows,
             "has_more" => true,
             "next_cursor" => "more"
           }}

        true ->
          flunk("unexpected request: #{method} #{url}")
      end
    end

    assert {:ok, result} =
             Importer.import_url(
               "https://www.notion.so/#{String.replace(@db_id, "-", "")}",
               api_key: "k",
               http: http
             )

    assert result.kind == "database"
    assert result.title == "Tasks"
    assert File.read!(result.markdown_path) =~ "| Name |"
    assert File.read!(result.markdown_path) =~ "Row1"
    assert result.warnings != []
    assert Enum.any?(result.warnings, &String.contains?(&1, "truncated"))
  end
end
