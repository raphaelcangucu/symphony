defmodule SymphonyElixir.Jira.AttachmentsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.Attachments

  @creds [base_url: "https://acme.atlassian.net", email: "bot@acme.test", api_token: "tok"]

  describe "download/2" do
    test "fetches attachment bytes with basic auth and resolves the content type" do
      parent = self()

      fun = fn url, headers ->
        send(parent, {:request, url, headers})
        {:ok, %{status: 200, headers: [{"content-type", "image/png"}], body: <<137, 80, 78, 71>>}}
      end

      assert {:ok, %{content_type: "image/png", body: <<137, 80, 78, 71>>}} =
               Attachments.download("10501", @creds ++ [request_fun: fun])

      assert_received {:request, url, headers}
      assert url == "https://acme.atlassian.net/rest/api/3/attachment/content/10501"

      expected = "Basic " <> Base.encode64("bot@acme.test:tok")
      assert {"Authorization", ^expected} = List.keyfind(headers, "Authorization", 0)
    end

    test "defaults the content type when the response omits it" do
      fun = fn _url, _headers -> {:ok, %{status: 200, headers: [], body: "data"}} end

      assert {:ok, %{content_type: "application/octet-stream", body: "data"}} =
               Attachments.download("1", @creds ++ [request_fun: fun])
    end

    test "maps non-success statuses to an error" do
      fun = fn _url, _headers -> {:ok, %{status: 404, headers: [], body: ""}} end

      assert {:error, {:jira_api_status, 404}} = Attachments.download("1", @creds ++ [request_fun: fun])
    end

    test "returns missing credentials when the token is absent" do
      assert {:error, :missing_jira_credentials} =
               Attachments.download("1", base_url: "https://acme.atlassian.net", email: "x", api_token: nil)
    end
  end

  describe "delete/2" do
    test "deletes an attachment with basic auth" do
      parent = self()

      fun = fn url, headers ->
        send(parent, {:delete_request, url, headers})
        {:ok, %{status: 204}}
      end

      assert :ok = Attachments.delete("10501", @creds ++ [delete_request_fun: fun])

      assert_received {:delete_request, url, headers}
      assert url == "https://acme.atlassian.net/rest/api/3/attachment/10501"

      expected = "Basic " <> Base.encode64("bot@acme.test:tok")
      assert {"Authorization", ^expected} = List.keyfind(headers, "Authorization", 0)
    end

    test "maps non-success statuses to an error" do
      fun = fn _url, _headers -> {:ok, %{status: 404}} end

      assert {:error, {:jira_api_status, 404}} = Attachments.delete("1", @creds ++ [delete_request_fun: fun])
    end
  end
end
