defmodule SymphonyElixir.LocalTracker.Git do
  @moduledoc "Thin git clone wrapper (overridable for tests)."

  @callback clone(String.t(), Path.t(), keyword()) ::
              {:ok, String.t()} | {:ok, :already_cloned} | {:error, String.t()}

  @behaviour __MODULE__

  @impl true
  def clone(url, dest, opts \\ []) do
    branch = Keyword.get(opts, :branch)

    cond do
      already_cloned?(dest, url) ->
        {:ok, :already_cloned}

      File.exists?(dest) and File.dir?(dest) and not empty_dir?(dest) ->
        {:error, "destination already exists and is not a clone of #{url}"}

      true ->
        do_clone(url, dest, branch)
    end
  end

  defp do_clone(url, dest, branch) do
    File.mkdir_p!(Path.dirname(dest))
    args = ["clone", "--depth", "1"] ++ branch_args(branch) ++ [authed_url(url), dest]

    case System.cmd("git", args, stderr_to_stdout: true) do
      {_out, 0} -> {:ok, head_sha(dest)}
      {out, _status} -> {:error, String.trim(out)}
    end
  rescue
    error in [ErlangError] -> {:error, "git not available: #{Exception.message(error)}"}
  end

  defp branch_args(nil), do: []
  defp branch_args(branch), do: ["--branch", branch]

  defp authed_url(url) do
    token = System.get_env("GITHUB_TOKEN")

    if is_binary(token) and String.starts_with?(url, "https://github.com/") do
      String.replace(url, "https://github.com/", "https://x-access-token:#{token}@github.com/")
    else
      url
    end
  end

  defp head_sha(dest) do
    case System.cmd("git", ["-C", dest, "rev-parse", "HEAD"], stderr_to_stdout: true) do
      {sha, 0} -> String.trim(sha)
      _ -> nil
    end
  end

  defp already_cloned?(dest, url) do
    File.dir?(Path.join(dest, ".git")) and remote_matches?(dest, url)
  end

  defp remote_matches?(dest, url) do
    case System.cmd("git", ["-C", dest, "remote", "get-url", "origin"], stderr_to_stdout: true) do
      {origin, 0} -> String.trim(origin) == url
      _ -> false
    end
  end

  defp empty_dir?(dest) do
    case File.ls(dest) do
      {:ok, entries} -> entries == []
      _ -> false
    end
  end
end
