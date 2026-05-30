defmodule SymphonyElixir.GitHub.BranchStatus do
  @moduledoc """
  Computes how many commits a pull request's head branch is behind its base
  branch using GitHub's REST compare endpoint
  (`GET /repos/{owner}/{repo}/compare/{base}...{head}`). `behind_by > 0` means the
  branch can be updated with the base. GitHub-backed projects only.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  @spec behind_by(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def behind_by(repo, base, head, opts \\ [])
      when is_binary(repo) and is_binary(base) and is_binary(head) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/compare/#{base}...#{head}"

      case client.rest_get(path, rest_opts) do
        {:ok, %{body: %{"behind_by" => behind}}} when is_integer(behind) and behind >= 0 ->
          {:ok, behind}

        {:ok, %{body: _other}} ->
          {:error, :unexpected_compare_body}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
