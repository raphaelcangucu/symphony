defmodule SymphonyElixir.Assistant.FileChangeCapture do
  @moduledoc """
  Captures per-file git patches for Codex-reported `file_change` paths that
  arrived without a native patch.

  Every path is diffed individually with a targeted, single-file `git diff`
  scoped to the repo that owns it — this module NEVER walks or diffs an
  entire workspace. Paths are resolved and validated to stay inside the
  thread workspace (and inside the git repo that owns them) before any git
  command runs, so a malicious or malformed path can neither escape the
  workspace nor trigger an unbounded scan.
  """

  @max_patch_chars 20_000

  @type file_capture :: %{
          required(String.t()) => String.t() | integer() | boolean() | nil
        }

  @spec capture(Path.t(), [String.t()]) :: [file_capture()]
  def capture(workspace, paths) when is_binary(workspace) and is_list(paths) do
    workspace_root = Path.expand(workspace)

    paths
    |> Enum.filter(&is_binary/1)
    |> Enum.uniq()
    |> Enum.map(&capture_one(workspace_root, &1))
    |> Enum.reject(&is_nil/1)
  end

  def capture(_workspace, _paths), do: []

  defp capture_one(workspace_root, reported_path) do
    with {:ok, repo_root, rel_path} <- resolve(workspace_root, reported_path),
         {:ok, status, patch} <- diff_single_file(repo_root, rel_path) do
      bound(reported_path, status, patch)
    else
      _ -> nil
    end
  end

  # Resolves `reported_path` to an absolute candidate under the workspace, then finds
  # the git repo that owns it via a single targeted `rev-parse`. Every hop re-validates
  # containment so a `..`-laden or absolute out-of-tree path is rejected rather than
  # silently diffed.
  defp resolve(workspace_root, reported_path) do
    trimmed = String.trim(reported_path)

    if trimmed == "" do
      :error
    else
      candidate = expand_candidate(workspace_root, trimmed)

      if within_root?(candidate, workspace_root) do
        resolve_repo(workspace_root, candidate)
      else
        :error
      end
    end
  end

  defp resolve_repo(workspace_root, candidate) do
    with existing_dir <- nearest_existing_dir(candidate, workspace_root),
         {:ok, toplevel} <- git_toplevel(existing_dir),
         repo_root <- Path.expand(toplevel),
         true <- within_root?(repo_root, workspace_root),
         true <- within_root?(candidate, repo_root) do
      {:ok, repo_root, Path.relative_to(candidate, repo_root)}
    else
      _ -> :error
    end
  end

  defp expand_candidate(workspace_root, path) do
    base = if Path.type(path) == :absolute, do: path, else: Path.join(workspace_root, path)
    Path.expand(base)
  end

  defp within_root?(path, root), do: path == root or String.starts_with?(path, root <> "/")

  defp nearest_existing_dir(candidate, fallback) do
    dir = if File.dir?(candidate), do: candidate, else: Path.dirname(candidate)
    find_existing(dir, fallback)
  end

  defp find_existing(dir, fallback) do
    cond do
      File.dir?(dir) -> dir
      dir == fallback or dir == "/" or dir == "." -> fallback
      true -> find_existing(Path.dirname(dir), fallback)
    end
  end

  defp git_toplevel(dir) do
    case System.cmd("git", ["rev-parse", "--show-toplevel"], cd: dir, stderr_to_stdout: true) do
      {output, 0} ->
        case String.trim(output) do
          "" -> :error
          toplevel -> {:ok, toplevel}
        end

      {_output, _status} ->
        :error
    end
  end

  defp diff_single_file(repo_root, rel_path) do
    case name_status(repo_root, rel_path) do
      {:ok, status} -> {:ok, status, tracked_patch(repo_root, rel_path)}
      :untracked -> {:ok, "added", untracked_patch(repo_root, rel_path)}
      :none -> {:ok, "unknown", ""}
    end
  end

  defp name_status(repo_root, rel_path) do
    case git(repo_root, ["diff", "--no-color", "--name-status", "HEAD", "--", rel_path]) do
      {:ok, output} when output != "" ->
        case parse_status(output) do
          status when is_binary(status) -> {:ok, status}
          nil -> untracked_or_none(repo_root, rel_path)
        end

      {:ok, _empty} ->
        untracked_or_none(repo_root, rel_path)

      {:error, _reason} ->
        :none
    end
  end

  defp untracked_or_none(repo_root, rel_path) do
    case git(repo_root, ["ls-files", "--others", "--exclude-standard", "--", rel_path]) do
      {:ok, output} when output != "" -> :untracked
      _ -> :none
    end
  end

  defp parse_status(output) do
    output
    |> String.split("\n", trim: true)
    |> List.first()
    |> parse_status_line()
  end

  defp parse_status_line(nil), do: nil

  defp parse_status_line(line) do
    case String.split(line, "\t", parts: 2) do
      [status, _path] -> status_letter(status)
      _ -> nil
    end
  end

  defp status_letter(<<"A", _::binary>>), do: "added"
  defp status_letter(<<"D", _::binary>>), do: "deleted"
  defp status_letter(<<"M", _::binary>>), do: "modified"
  defp status_letter(<<"R", _::binary>>), do: "renamed"
  defp status_letter(<<"C", _::binary>>), do: "copied"
  defp status_letter(<<"T", _::binary>>), do: "type_changed"
  defp status_letter(_status), do: nil

  defp tracked_patch(repo_root, rel_path) do
    case git(repo_root, ["diff", "--no-color", "HEAD", "--", rel_path]) do
      {:ok, patch} -> patch
      {:error, _reason} -> ""
    end
  end

  defp untracked_patch(repo_root, rel_path) do
    case git_allow_diff_exit(repo_root, ["diff", "--no-color", "--no-index", "--", "/dev/null", rel_path]) do
      {:ok, patch} -> patch
      {:error, _reason} -> ""
    end
  end

  defp bound(path, status, patch) do
    {additions, deletions} = diff_counts(patch)
    length = String.length(patch)
    truncated = length > @max_patch_chars
    bounded_patch = if truncated, do: String.slice(patch, 0, @max_patch_chars), else: patch

    %{
      "path" => path,
      "status" => status,
      "patch" => bounded_patch,
      "additions" => additions,
      "deletions" => deletions,
      "truncated" => truncated
    }
  end

  defp diff_counts(patch) when is_binary(patch) do
    lines = String.split(patch, "\n")
    additions = Enum.count(lines, &(String.starts_with?(&1, "+") and not String.starts_with?(&1, "+++")))
    deletions = Enum.count(lines, &(String.starts_with?(&1, "-") and not String.starts_with?(&1, "---")))
    {additions, deletions}
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end

  defp git_allow_diff_exit(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, status} when status in [0, 1] -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end
end
