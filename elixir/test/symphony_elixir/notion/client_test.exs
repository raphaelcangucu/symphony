defmodule SymphonyElixir.Notion.ClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Notion.Client

  test "retrieve_page returns decoded map" do
    http = fn :get, url, _opts ->
      assert url =~ "/v1/pages/"
      {:ok, 200, %{"object" => "page", "id" => "39c33f2e-afc1-4020-ac9b-c223b4520d17"}}
    end

    assert {:ok, %{"object" => "page"}} =
             Client.retrieve_page("39c33f2e-afc1-4020-ac9b-c223b4520d17", api_key: "k", http: http)
  end

  test "retrieve_database returns decoded map" do
    http = fn :get, url, _opts ->
      assert url =~ "/v1/databases/"
      {:ok, 200, %{"object" => "database", "id" => "ba15679b-2eb3-4182-a336-57d314df88e0"}}
    end

    assert {:ok, %{"object" => "database"}} =
             Client.retrieve_database("ba15679b-2eb3-4182-a336-57d314df88e0",
               api_key: "k",
               http: http
             )
  end

  test "maps 401 to unauthorized" do
    http = fn :get, _url, _opts -> {:ok, 401, %{"message" => "Invalid"}} end
    assert {:error, :unauthorized} = Client.retrieve_page("x", api_key: "bad", http: http)
  end

  test "maps 403 to forbidden" do
    http = fn :get, _url, _opts -> {:ok, 403, %{"message" => "Forbidden"}} end
    assert {:error, :forbidden} = Client.retrieve_page("x", api_key: "k", http: http)
  end

  test "maps 404 to not_found" do
    http = fn :get, _url, _opts -> {:ok, 404, %{"message" => "Not found"}} end
    assert {:error, :not_found} = Client.retrieve_page("x", api_key: "k", http: http)
  end

  test "maps other status to http_error" do
    http = fn :get, _url, _opts -> {:ok, 500, %{"message" => "boom"}} end

    assert {:error, {:http_error, 500, %{"message" => "boom"}}} =
             Client.retrieve_page("x", api_key: "k", http: http)
  end

  test "missing api_key returns missing_api_key without calling http" do
    http = fn _method, _url, _opts ->
      flunk("http must not be called when api_key is missing")
    end

    assert {:error, :missing_api_key} = Client.retrieve_page("x", http: http)
    assert {:error, :missing_api_key} = Client.retrieve_page("x", api_key: "", http: http)
    assert {:error, :missing_api_key} = Client.retrieve_page("x", api_key: "   ", http: http)
  end

  test "list_block_children paginates and concatenates results" do
    http = fn :get, url, _opts ->
      assert url =~ "/v1/blocks/block-id/children"

      cond do
        not String.contains?(url, "start_cursor=") ->
          {:ok, 200,
           %{
             "results" => [%{"id" => "b1"}, %{"id" => "b2"}],
             "has_more" => true,
             "next_cursor" => "cursor-2"
           }}

        String.contains?(url, "start_cursor=cursor-2") ->
          {:ok, 200,
           %{
             "results" => [%{"id" => "b3"}],
             "has_more" => false,
             "next_cursor" => nil
           }}

        true ->
          flunk("unexpected pagination url: #{url}")
      end
    end

    assert {:ok, [%{"id" => "b1"}, %{"id" => "b2"}, %{"id" => "b3"}]} =
             Client.list_block_children("block-id", api_key: "k", http: http)
  end

  test "query_database stops at 100 rows and reports truncated" do
    page_one = for i <- 1..100, do: %{"id" => "row-#{i}"}

    http = fn :post, url, opts ->
      assert url =~ "/v1/databases/db-id/query"
      assert is_map(opts[:json])

      body = opts[:json] || %{}

      if Map.get(body, "start_cursor") in [nil] do
        {:ok, 200,
         %{
           "results" => page_one,
           "has_more" => true,
           "next_cursor" => "more"
         }}
      else
        flunk("query_database must not request a second page after reaching 100 rows")
      end
    end

    assert {:ok, %{results: rows, truncated: true}} =
             Client.query_database("db-id", api_key: "k", http: http)

    assert length(rows) == 100
    assert hd(rows)["id"] == "row-1"
  end

  test "query_database returns truncated false when under limit" do
    http = fn :post, url, opts ->
      assert url =~ "/v1/databases/db-id/query"
      assert opts[:json] == %{}

      {:ok, 200,
       %{
         "results" => [%{"id" => "a"}, %{"id" => "b"}],
         "has_more" => false
       }}
    end

    assert {:ok, %{results: [%{"id" => "a"}, %{"id" => "b"}], truncated: false}} =
             Client.query_database("db-id", api_key: "k", http: http)
  end

  test "download returns binary body on 200" do
    http = fn :get, url, opts ->
      assert url == "https://cdn.example.com/file.png"
      headers = opts[:headers] || []

      refute Enum.any?(headers, fn
               {"Notion-Version", _} -> true
               {"notion-version", _} -> true
               _ -> false
             end)

      {:ok, 200, <<137, 80, 78, 71>>}
    end

    assert {:ok, <<137, 80, 78, 71>>} =
             Client.download("https://cdn.example.com/file.png", api_key: "k", http: http)
  end

  test "sends Authorization and Notion-Version headers for API calls" do
    http = fn :get, _url, opts ->
      headers = opts[:headers] || []
      assert {"Authorization", "Bearer secret-key"} in headers
      assert {"Notion-Version", "2022-06-28"} in headers
      assert {"Content-Type", "application/json"} in headers
      {:ok, 200, %{"object" => "page"}}
    end

    assert {:ok, _} = Client.retrieve_page("page-id", api_key: "secret-key", http: http)
  end
end
