defmodule SymphonyElixir.GitHub.AttachmentRewriterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.AttachmentStore
  alias SymphonyElixir.GitHub.AttachmentRewriter
  alias SymphonyElixir.LocalTracker.Context

  @png_bytes <<137, 80, 78, 71, 13, 10, 26, 10>>
  @owner "macro-org"
  @repo "macro-repo"
  @slug "macro-markets"

  setup do
    tmp_dir = Path.join(System.tmp_dir!(), "symphony-rewriter-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp_dir)
    Application.put_env(:symphony_elixir, :workspace_root, tmp_dir)

    on_exit(fn ->
      File.rm_rf!(tmp_dir)
      Application.delete_env(:symphony_elixir, :workspace_root)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: @slug})
    :ok
  end

  test "uploads referenced image to the assets branch and rewrites the URL" do
    {stored, bytes} = store_png()
    body = "See screenshot:\n\n![shot.png](#{local_url(stored["path"])})"

    rewritten = AttachmentRewriter.rewrite(body, @owner, @repo, @slug, client: HappyClient)

    digest = :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
    expected = "https://github.com/#{@owner}/#{@repo}/raw/symphony-assets/assets/#{digest}.png"

    assert rewritten == "See screenshot:\n\n![shot.png](#{expected})"
    refute rewritten =~ "/api/tracker/v1/"

    assert_received {:rest_post, "/repos/macro-org/macro-repo/git/refs", %{"ref" => "refs/heads/symphony-assets"}}
    assert_received {:rest_put, put_path, %{"content" => content, "branch" => "symphony-assets"}}
    assert put_path == "/repos/macro-org/macro-repo/contents/assets/#{digest}.png"
    assert Base.decode64!(content) == bytes
  end

  test "rewrites the same attachment once even when referenced multiple times" do
    {stored, bytes} = store_png()
    url = local_url(stored["path"])
    body = "![a](#{url}) and again ![b](#{url})"

    rewritten = AttachmentRewriter.rewrite(body, @owner, @repo, @slug, client: HappyClient)

    digest = :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
    raw = "https://github.com/#{@owner}/#{@repo}/raw/symphony-assets/assets/#{digest}.png"
    assert rewritten == "![a](#{raw}) and again ![b](#{raw})"

    puts = collect_messages(:rest_put)
    assert length(puts) == 1
  end

  test "leaves the body untouched when there are no attachments" do
    body = "Just text with a [link](https://example.com)."
    assert AttachmentRewriter.rewrite(body, @owner, @repo, @slug, client: HappyClient) == body
  end

  test "non-binary bodies pass through unchanged" do
    assert AttachmentRewriter.rewrite(nil, @owner, @repo, @slug, client: HappyClient) == nil
  end

  test "keeps the original URL when the upload fails (best-effort)" do
    {stored, _bytes} = store_png()
    body = "![shot.png](#{local_url(stored["path"])})"

    assert AttachmentRewriter.rewrite(body, @owner, @repo, @slug, client: FailingPutClient) == body
  end

  test "keeps the original URL when the assets branch cannot be ensured" do
    {stored, _bytes} = store_png()
    body = "![shot.png](#{local_url(stored["path"])})"

    assert AttachmentRewriter.rewrite(body, @owner, @repo, @slug, client: NoBranchClient) == body
  end

  test "restore/3 is the inverse of rewrite/5 (round-trip keeps local URLs)" do
    {stored, _bytes} = store_png()
    original = "Look:\n\n![shot.png](#{local_url(stored["path"])})\n\nend"

    rewritten = AttachmentRewriter.rewrite(original, @owner, @repo, @slug, client: HappyClient)
    refute rewritten == original
    assert rewritten =~ "raw/symphony-assets/assets/"

    restored = AttachmentRewriter.restore(rewritten, @slug)
    assert restored == original
  end

  test "restore/3 leaves unknown managed assets untouched" do
    body =
      "![x](https://github.com/#{@owner}/#{@repo}/raw/symphony-assets/assets/" <>
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00.png)"

    assert AttachmentRewriter.restore(body, @slug) == body
  end

  test "restore/3 leaves bodies without managed assets unchanged" do
    body = "Plain body with ![x](#{local_url("uploads/abc.png")})"
    assert AttachmentRewriter.restore(body, @slug) == body
  end

  test "proxy_remote_assets/2 rewrites managed asset URLs to the project proxy path" do
    raw = "https://github.com/#{@owner}/#{@repo}/raw/symphony-assets/assets/abc123.png"
    body = "![image.png](#{raw})"

    assert AttachmentRewriter.proxy_remote_assets(body, @slug) ==
             "![image.png](/api/tracker/v1/projects/#{@slug}/github/assets/#{@owner}/#{@repo}/abc123.png)"
  end

  test "proxy_remote_assets/2 leaves local attachment URLs untouched" do
    body = "![x](#{local_url("uploads/abc.png")})"
    assert AttachmentRewriter.proxy_remote_assets(body, @slug) == body
  end

  test "proxy_remote_assets/2 passes non-binary bodies through unchanged" do
    assert AttachmentRewriter.proxy_remote_assets(nil, @slug) == nil
  end

  test "download_asset/4 fetches bytes via the contents API for a managed asset" do
    bytes = <<137, 80, 78, 71>>

    download_fun = fn url, headers ->
      send(self(), {:download, url, headers})
      {:ok, %{status: 200, body: bytes}}
    end

    assert {:ok, %{content_type: "image/png", body: ^bytes}} =
             AttachmentRewriter.download_asset(@owner, @repo, "abcDEF12.png",
               token: "ghp_test",
               download_fun: download_fun
             )

    assert_received {:download, url, headers}
    assert url == "https://api.github.com/repos/#{@owner}/#{@repo}/contents/assets/abcDEF12.png?ref=symphony-assets"
    assert {"Accept", "application/vnd.github.raw"} in headers
    assert {"Authorization", "Bearer ghp_test"} in headers
  end

  test "download_asset/4 rejects a basename that is not content-addressed" do
    assert {:error, :invalid_asset} =
             AttachmentRewriter.download_asset(@owner, @repo, "../secret.png", token: "ghp_test")
  end

  test "download_asset/4 maps a remote 404 to a github_api_status error" do
    download_fun = fn _url, _headers -> {:ok, %{status: 404, body: ""}} end

    assert {:error, {:github_api_status, 404}} =
             AttachmentRewriter.download_asset(@owner, @repo, "abc123.png",
               token: "ghp_test",
               download_fun: download_fun
             )
  end

  test "has_managed_asset?/1 detects Symphony-managed GitHub asset URLs" do
    assert AttachmentRewriter.has_managed_asset?("https://github.com/o/r/raw/symphony-assets/assets/abc.png")

    refute AttachmentRewriter.has_managed_asset?("https://github.com/o/r/blob/main/x.png")
    refute AttachmentRewriter.has_managed_asset?(nil)
  end

  test "contains_attachment?/2 detects local attachment URLs for the project" do
    assert AttachmentRewriter.contains_attachment?(
             "![x](#{local_url("uploads/abc.png")})",
             @slug
           )

    refute AttachmentRewriter.contains_attachment?("no attachments here", @slug)
    refute AttachmentRewriter.contains_attachment?(local_url("uploads/abc.png"), "other-project")
  end

  defp store_png do
    bytes = @png_bytes <> <<System.unique_integer([:positive])::64>>
    source = Path.join(System.tmp_dir!(), "shot-#{System.unique_integer([:positive])}.png")
    File.write!(source, bytes)
    upload = %Plug.Upload{path: source, filename: "shot.png", content_type: "image/png"}
    {:ok, stored} = AttachmentStore.store_image(@slug, upload)
    {stored, bytes}
  end

  defp local_url(path) do
    "/api/tracker/v1/projects/#{@slug}/assistant/attachments/#{path}"
  end

  defp collect_messages(tag) do
    receive do
      msg when elem(msg, 0) == tag -> [msg | collect_messages(tag)]
    after
      0 -> []
    end
  end
end

defmodule SymphonyElixir.GitHub.AttachmentRewriterTest.BaseClient do
  @moduledoc false

  def branch_missing(path) do
    cond do
      String.ends_with?(path, "/git/ref/heads/symphony-assets") -> {:error, {:github_api_status, 404}}
      String.ends_with?(path, "/git/ref/heads/main") -> {:ok, %{status: 200, body: %{"object" => %{"sha" => "basesha"}}}}
      String.contains?(path, "/contents/") -> {:error, {:github_api_status, 404}}
      Regex.match?(~r{^/repos/[^/]+/[^/]+$}, path) -> {:ok, %{status: 200, body: %{"default_branch" => "main"}}}
      true -> {:error, {:github_api_status, 404}}
    end
  end
end

defmodule HappyClient do
  @moduledoc false
  alias SymphonyElixir.GitHub.AttachmentRewriterTest.BaseClient

  def rest_get(path, _opts \\ []), do: BaseClient.branch_missing(path)

  def rest_post(path, body, _opts \\ []) do
    send(self(), {:rest_post, path, body})
    {:ok, %{status: 201, body: %{}}}
  end

  def rest_put(path, body, _opts \\ []) do
    send(self(), {:rest_put, path, body})
    {:ok, %{status: 201, body: %{}}}
  end
end

defmodule FailingPutClient do
  @moduledoc false
  alias SymphonyElixir.GitHub.AttachmentRewriterTest.BaseClient

  def rest_get(path, _opts \\ []), do: BaseClient.branch_missing(path)

  def rest_post(_path, _body, _opts \\ []), do: {:ok, %{status: 201, body: %{}}}

  def rest_put(_path, _body, _opts \\ []), do: {:error, {:github_api_status, 422}}
end

defmodule NoBranchClient do
  @moduledoc false

  def rest_get(path, _opts \\ []) do
    cond do
      String.ends_with?(path, "/git/ref/heads/symphony-assets") -> {:error, {:github_api_status, 404}}
      true -> {:error, {:github_api_status, 500}}
    end
  end

  def rest_post(_path, _body, _opts \\ []), do: {:error, {:github_api_status, 500}}

  def rest_put(_path, _body, _opts \\ []), do: {:error, {:github_api_status, 500}}
end
