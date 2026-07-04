defmodule SymphonyElixir.Evidence.WorkspaceCommit do
  @moduledoc "Creates local git commits for dirty repositories inside a workspace."

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type commit_result :: %{
          repo: String.t(),
          sha: String.t(),
          message: String.t(),
          files: [String.t()]
        }

  @spec commit(Path.t(), String.t()) ::
          {:ok, [commit_result()]} | {:error, :invalid_commit_message | {:commit_failed, String.t(), String.t()}}
  def commit(workspace, message) when is_binary(workspace) and is_binary(message) do
    with {:ok, normalized_message} <- normalize_message(message) do
      workspace
      |> RunContract.repo_states()
      |> Enum.reduce_while({:ok, []}, fn repo, {:ok, commits} ->
        case commit_repo(repo, normalized_message) do
          {:ok, nil} -> {:cont, {:ok, commits}}
          {:ok, result} -> {:cont, {:ok, [result | commits]}}
          {:error, reason} -> {:halt, {:error, reason}}
        end
      end)
      |> case do
        {:ok, commits} -> {:ok, Enum.reverse(commits)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  def commit(_workspace, _message), do: {:error, :invalid_commit_message}

  defp normalize_message(message) do
    case String.trim(message) do
      "" -> {:error, :invalid_commit_message}
      trimmed -> {:ok, trimmed}
    end
  end

  defp commit_repo(%RepoState{} = repo, message) do
    with {:ok, files} <- changed_files(repo),
         false <- files == [],
         :ok <- git_ok(repo.path, ["add", "-A"]),
         :ok <- git_ok(repo.path, ["commit", "-m", message]),
         {:ok, sha} <- git(repo.path, ["rev-parse", "HEAD"]) do
      {:ok, %{repo: repo.name, sha: sha, message: message, files: files}}
    else
      true ->
        {:ok, nil}

      {:error, {_status, output}} ->
        {:error, {:commit_failed, repo.name, output}}
    end
  end

  defp changed_files(%RepoState{} = repo) do
    case git(repo.path, ["status", "--porcelain", "--untracked-files=normal"]) do
      {:ok, output} ->
        files =
          output
          |> String.split("\n", trim: true)
          |> Enum.map(&status_path/1)
          |> Enum.reject(&is_nil/1)
          |> Enum.uniq()
          |> Enum.sort()

        {:ok, files}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp status_path(line) do
    line
    |> String.slice(3..-1//1)
    |> case do
      nil -> nil
      path -> path |> String.trim() |> normalize_renamed_path()
    end
  end

  defp normalize_renamed_path(path) do
    case String.split(path, " -> ", parts: 2) do
      [_old, new] -> new
      [single] -> single
    end
  end

  defp git_ok(path, args) do
    case git(path, args) do
      {:ok, _output} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim_trailing(output)}}
    end
  end
end
