defmodule SymphonyElixir.AgentLifecycle.ReleaseSource do
  @moduledoc """
  Resolves current provider releases and platform artifacts.

  The mappings follow Jean's proven release sources and names: Anthropic's
  binary manifest for Claude, GitHub assets for Codex/OpenCode, and Cursor's
  official installer. Network access is injectable so the complete release
  flow can run against deterministic E2E fixtures.
  """

  alias SymphonyElixir.AgentLifecycle.Catalog

  @spec latest(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def latest(agent, options \\ [])

  def latest("claude", options), do: latest_claude(options)
  def latest("codex", options), do: latest_github("codex", options)
  def latest("opencode", options), do: latest_github("opencode", options)

  def latest("cursor", _options) do
    release = Catalog.fetch!("cursor").release
    {:ok, %{version: "latest", url: release.url, checksum: nil, format: :installer}}
  end

  def latest(_agent, _options), do: {:error, :unknown_agent}

  defp latest_claude(options) do
    base = Catalog.fetch!("claude").release.base_url

    with {:ok, platform} <- claude_platform(options),
         {:ok, version_body} <- get(base <> "/latest", options),
         version when version != "" <- String.trim(version_body),
         {:ok, manifest_body} <- get("#{base}/#{version}/manifest.json", options),
         {:ok, manifest} <- Jason.decode(manifest_body),
         checksum when is_binary(checksum) <-
           get_in(manifest, ["platforms", platform, "checksum"]) do
      executable = if String.starts_with?(platform, "win32"), do: "claude.exe", else: "claude"

      {:ok,
       %{
         version: version,
         url: "#{base}/#{version}/#{platform}/#{executable}",
         checksum: checksum,
         format: :raw
       }}
    else
      nil -> {:error, :checksum_unavailable}
      "" -> {:error, :version_unavailable}
      {:error, _reason} = error -> error
      _ -> {:error, :invalid_manifest}
    end
  end

  defp latest_github(agent, options) do
    with {:ok, candidates} <- github_candidates(agent, options),
         api <- Catalog.fetch!(agent).release.api <> "?per_page=100",
         {:ok, body} <- get(api, options),
         {:ok, releases} when is_list(releases) <- Jason.decode(body),
         {:ok, release, asset, candidate} <- find_release(releases, candidates, agent) do
      {:ok,
       %{
         version: release_version(release["tag_name"]),
         url: asset["browser_download_url"],
         checksum: digest_checksum(asset["digest"]),
         format: candidate.format,
         binary_entry: candidate.binary_entry,
         artifact: asset["name"]
       }}
    else
      {:error, _reason} = error -> error
      _ -> {:error, :invalid_release_response}
    end
  end

  defp find_release(releases, candidates, agent) do
    Enum.find_value(releases, {:error, :release_unavailable}, fn release ->
      if eligible_release?(release, agent) do
        Enum.find_value(candidates, fn candidate ->
          case Enum.find(release["assets"] || [], &(&1["name"] == candidate.name)) do
            nil -> nil
            asset -> {:ok, release, asset, candidate}
          end
        end)
      end
    end)
  end

  defp eligible_release?(release, "opencode"), do: release["draft"] != true
  defp eligible_release?(_release, "codex"), do: true

  defp github_candidates("opencode", options) do
    case platform(options) do
      {:linux, :x86_64} -> candidate("opencode-linux-x64.tar.gz", "opencode", :tar_gz)
      {:linux, :aarch64} -> candidate("opencode-linux-arm64.tar.gz", "opencode", :tar_gz)
      {:darwin, :x86_64} -> candidate("opencode-darwin-x64.zip", "opencode", :zip)
      {:darwin, :aarch64} -> candidate("opencode-darwin-arm64.zip", "opencode", :zip)
      {:windows, :x86_64} -> candidate("opencode-windows-x64.zip", "opencode.exe", :zip)
      _ -> {:error, :unsupported_platform}
    end
  end

  defp github_candidates("codex", options) do
    case platform(options) do
      {:linux, :x86_64} ->
        candidates([
          {"x86_64-unknown-linux-musl", :tar_gz},
          {"x86_64-unknown-linux-gnu", :tar_gz}
        ])

      {:linux, :aarch64} ->
        candidates([
          {"aarch64-unknown-linux-musl", :tar_gz},
          {"aarch64-unknown-linux-gnu", :tar_gz}
        ])

      {:darwin, :x86_64} ->
        candidates([{"x86_64-apple-darwin", :tar_gz}])

      {:darwin, :aarch64} ->
        candidates([{"aarch64-apple-darwin", :tar_gz}])

      {:windows, :x86_64} ->
        codex_zip_candidate("x86_64-pc-windows-msvc")

      {:windows, :aarch64} ->
        codex_zip_candidate("aarch64-pc-windows-msvc")

      _ ->
        {:error, :unsupported_platform}
    end
  end

  defp candidates(targets) do
    {:ok,
     Enum.map(targets, fn {target, format} ->
       %{name: "codex-#{target}.tar.gz", binary_entry: "codex-#{target}", format: format}
     end)}
  end

  defp codex_zip_candidate(target) do
    {:ok,
     [
       %{
         name: "codex-#{target}.exe.zip",
         binary_entry: "codex-#{target}.exe",
         format: :zip
       }
     ]}
  end

  defp candidate(name, binary_entry, format),
    do: {:ok, [%{name: name, binary_entry: binary_entry, format: format}]}

  defp claude_platform(options) do
    case platform(options) do
      {:linux, :x86_64} -> {:ok, "linux-x64"}
      {:linux, :aarch64} -> {:ok, "linux-arm64"}
      {:darwin, :x86_64} -> {:ok, "darwin-x64"}
      {:darwin, :aarch64} -> {:ok, "darwin-arm64"}
      {:windows, :x86_64} -> {:ok, "win32-x64"}
      _ -> {:error, :unsupported_platform}
    end
  end

  defp platform(options) do
    os = Keyword.get_lazy(options, :os, &host_os/0)
    arch = Keyword.get_lazy(options, :arch, &host_arch/0)
    {os, arch}
  end

  defp host_os do
    case :os.type() do
      {:unix, :darwin} -> :darwin
      {:unix, _name} -> :linux
      {:win32, _name} -> :windows
    end
  end

  defp host_arch do
    architecture = :erlang.system_info(:system_architecture) |> List.to_string()
    if String.starts_with?(architecture, "aarch64"), do: :aarch64, else: :x86_64
  end

  defp get(url, options) do
    request = Keyword.get(options, :request, &request/1)

    case request.(url) do
      {:ok, %{status: status, body: body}} when status in 200..299 and is_binary(body) ->
        {:ok, body}

      {:ok, %{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, {:request_failed, reason}}
    end
  end

  defp request(url) do
    case Req.get(url, headers: [{"user-agent", "symphony"}]) do
      {:ok, %Req.Response{status: status, body: body}} when is_binary(body) ->
        {:ok, %{status: status, body: body}}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:ok, %{status: status, body: Jason.encode!(body)}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp digest_checksum("sha256:" <> checksum), do: String.downcase(checksum)
  defp digest_checksum(_digest), do: nil

  defp release_version(tag) when is_binary(tag) do
    case Regex.run(~r/(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)/, tag) do
      [_, version] -> version
      _ -> String.trim_leading(tag, "v")
    end
  end
end
