defmodule SymphonyElixir.GitHub.PullRequestUrl do
  @moduledoc "Parses a GitHub pull request URL into its owner/name/number parts."

  @pattern ~r{^https?://github\.com/([^/\s]+)/([^/\s]+)/pull/(\d+)}

  @type parsed :: %{repo: String.t(), owner: String.t(), name: String.t(), number: pos_integer()}

  @spec parse(String.t() | nil) :: {:ok, parsed()} | {:error, :invalid_pr_url}
  def parse(url) when is_binary(url) do
    case Regex.run(@pattern, String.trim(url)) do
      [_, owner, name, number] ->
        {:ok, %{repo: "#{owner}/#{name}", owner: owner, name: name, number: String.to_integer(number)}}

      _ ->
        {:error, :invalid_pr_url}
    end
  end

  def parse(_url), do: {:error, :invalid_pr_url}
end
