defmodule SymphonyElixir.GitHub.RepoSpec do
  @moduledoc false

  @spec split(String.t() | nil) :: {:ok, {String.t(), String.t()}} | {:error, term()}
  def split(nil), do: {:error, :missing_github_repo}

  def split(repo) when is_binary(repo) do
    case String.split(repo, "/", parts: 2) do
      [owner, name] when owner != "" and name != "" -> {:ok, {owner, name}}
      _ -> {:error, {:invalid_github_repo, repo}}
    end
  end
end
