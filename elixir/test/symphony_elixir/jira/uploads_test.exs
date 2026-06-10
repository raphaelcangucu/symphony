defmodule SymphonyElixir.Jira.UploadsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.Uploads

  @moduletag :tmp_dir

  @opts [base_url: "https://acme.atlassian.net", email: "bot@acme.dev", api_token: "token-123"]

  setup %{tmp_dir: tmp_dir} do
    path = Path.join(tmp_dir, "screen.png")
    File.write!(path, "the-bytes")
    %{path: path}
  end

  test "posts a multipart attachment and returns the Jira content URL", %{path: path} do
    request_fun = fn url, headers, multipart ->
      assert url == "https://acme.atlassian.net/rest/api/3/issue/PROJ-1/attachments"
      assert {"X-Atlassian-Token", "no-check"} in headers
      assert {"Authorization", "Basic " <> _} = List.keyfind(headers, "Authorization", 0)
      assert [file: {"the-bytes", filename: "screen.png", content_type: "image/png"}] == multipart

      {:ok, [%{"id" => "10001", "filename" => "screen.png", "content" => "https://acme.atlassian.net/rest/api/3/attachment/content/10001"}]}
    end

    assert {:ok, "https://acme.atlassian.net/rest/api/3/attachment/content/10001"} =
             Uploads.upload("PROJ-1", path, "screen.png", "image/png", [{:request_fun, request_fun} | @opts])
  end

  test "errors when credentials are missing", %{path: path} do
    assert {:error, :missing_jira_credentials} =
             Uploads.upload("PROJ-1", path, "screen.png", "image/png", base_url: "https://acme.atlassian.net", email: nil, api_token: nil)
  end

  test "surfaces an unexpected attachment payload", %{path: path} do
    request_fun = fn _url, _headers, _multipart -> {:ok, %{"errorMessages" => ["nope"]}} end

    assert {:error, {:jira_attachment_unexpected, _}} =
             Uploads.upload("PROJ-1", path, "screen.png", "image/png", [{:request_fun, request_fun} | @opts])
  end

  test "surfaces a request failure", %{path: path} do
    request_fun = fn _url, _headers, _multipart -> {:error, {:jira_attachment_status, 413}} end

    assert {:error, {:jira_attachment_status, 413}} =
             Uploads.upload("PROJ-1", path, "screen.png", "image/png", [{:request_fun, request_fun} | @opts])
  end
end
