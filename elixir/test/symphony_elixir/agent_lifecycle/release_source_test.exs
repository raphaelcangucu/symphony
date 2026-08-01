defmodule SymphonyElixir.AgentLifecycle.ReleaseSourceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentLifecycle.ReleaseSource

  test "resolves Claude latest plus the upstream platform checksum" do
    checksum = String.duplicate("a", 64)

    request = fn url ->
      if String.ends_with?(url, "/latest") do
        {:ok, %{status: 200, body: "2.1.42\n"}}
      else
        assert String.ends_with?(url, "/2.1.42/manifest.json")

        {:ok,
         %{
           status: 200,
           body: Jason.encode!(%{"platforms" => %{"linux-x64" => %{"checksum" => checksum}}})
         }}
      end
    end

    assert {:ok, release} =
             ReleaseSource.latest("claude", request: request, os: :linux, arch: :x86_64)

    assert release.version == "2.1.42"
    assert release.format == :raw
    assert release.checksum == checksum
    assert String.ends_with?(release.url, "/2.1.42/linux-x64/claude")
  end

  test "selects Jean-compatible GitHub assets for Codex and OpenCode" do
    request = fn _url ->
      {:ok,
       %{
         status: 200,
         body:
           Jason.encode!([
             %{
               "tag_name" => "rust-v0.99.0",
               "prerelease" => true,
               "assets" => [
                 %{
                   "name" => "codex-x86_64-unknown-linux-musl.tar.gz",
                   "browser_download_url" => "https://fixture/codex.tgz",
                   "digest" => "sha256:#{String.duplicate("b", 64)}"
                 }
               ]
             }
           ])
       }}
    end

    assert {:ok, codex} =
             ReleaseSource.latest("codex", request: request, os: :linux, arch: :x86_64)

    assert codex.version == "0.99.0"
    assert codex.url == "https://fixture/codex.tgz"
    assert codex.format == :tar_gz
    assert codex.binary_entry == "codex-x86_64-unknown-linux-musl"
    assert codex.checksum == String.duplicate("b", 64)

    request = fn _url ->
      {:ok,
       %{
         status: 200,
         body:
           Jason.encode!([
             %{
               "tag_name" => "v1.2.3",
               "draft" => false,
               "assets" => [
                 %{
                   "name" => "opencode-linux-x64.tar.gz",
                   "browser_download_url" => "https://fixture/opencode.tgz"
                 }
               ]
             }
           ])
       }}
    end

    assert {:ok, opencode} =
             ReleaseSource.latest("opencode", request: request, os: :linux, arch: :x86_64)

    assert opencode.version == "1.2.3"
    assert opencode.format == :tar_gz
    assert opencode.binary_entry == "opencode"
    assert opencode.checksum == nil
  end

  test "declares Cursor's official installer for disposable-home staging" do
    assert {:ok, release} = ReleaseSource.latest("cursor")
    assert release.version == "latest"
    assert release.url == "https://cursor.com/install"
    assert release.format == :installer
  end

  test "returns an unsupported-platform error without guessing an asset" do
    assert {:error, :unsupported_platform} =
             ReleaseSource.latest("opencode", os: :freebsd, arch: :x86_64)
  end
end
