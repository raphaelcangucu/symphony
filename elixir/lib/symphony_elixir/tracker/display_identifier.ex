defmodule SymphonyElixir.Tracker.DisplayIdentifier do
  @moduledoc """
  Derives the human-facing identifier shown for an issue in the tracker UI.

  The canonical `identifier` stays the routing key everywhere it matters (issue
  URLs, drag ids, agent/orchestrator bindings, the local DB unique index). Locally
  drafted issues start life with a slug-based key like `MAC-1`; once an issue is
  reconciled with its external tracker, that external key is the one users should
  see.

  Reconciliation state is read from the issue's external URL — the field that is
  populated on every sync path (GitHub/Linear/Jira `remote_url`) and survives
  later pulls. We reconstruct the external key from that URL by host, falling back
  to the repository name (GitHub only) and finally to the canonical identifier
  when no external link exists yet. The function is pure and total: it always
  returns a value and never raises.
  """

  @github_issue ~r{github\.com/[^/\s]+/(?<repo>[^/\s]+)/issues/(?<number>\d+)}i
  @jira_browse ~r{atlassian\.net/browse/(?<key>[A-Za-z][A-Za-z0-9_]*-\d+)}i
  @linear_issue ~r{linear\.app/[^/\s]+/issue/(?<key>[A-Za-z][A-Za-z0-9_]*-\d+)}i
  @numeric_identifier ~r/^\d+$/

  @doc """
  Resolves the display identifier from the canonical `identifier`, the external
  issue `url`, and an optional GitHub `repository_full_name` (`owner/repo`).
  """
  @spec resolve(String.t() | nil, String.t() | nil, String.t() | nil) :: String.t() | nil
  def resolve(identifier, url, repository_full_name \\ nil) do
    canonical = normalize(identifier)

    from_url(url) || from_repository(canonical, repository_full_name) || canonical
  end

  defp from_url(url) when is_binary(url) do
    from_github(url) || from_jira(url) || from_linear(url)
  end

  defp from_url(_url), do: nil

  defp from_github(url) do
    case Regex.named_captures(@github_issue, url) do
      %{"repo" => repo, "number" => number} -> "#{repo}##{number}"
      _ -> nil
    end
  end

  defp from_jira(url) do
    case Regex.named_captures(@jira_browse, url) do
      %{"key" => key} -> String.upcase(key)
      _ -> nil
    end
  end

  defp from_linear(url) do
    case Regex.named_captures(@linear_issue, url) do
      %{"key" => key} -> String.upcase(key)
      _ -> nil
    end
  end

  defp from_repository(canonical, repository_full_name)
       when is_binary(canonical) and is_binary(repository_full_name) do
    with true <- Regex.match?(@numeric_identifier, canonical),
         repo when is_binary(repo) <- short_repo_name(repository_full_name) do
      "#{repo}##{canonical}"
    else
      _ -> nil
    end
  end

  defp from_repository(_canonical, _repository_full_name), do: nil

  defp short_repo_name(repository_full_name) do
    repository_full_name
    |> String.split("/")
    |> List.last()
    |> case do
      repo when is_binary(repo) and repo != "" -> repo
      _ -> nil
    end
  end

  defp normalize(identifier) when is_binary(identifier), do: String.trim(identifier)
  defp normalize(identifier), do: identifier
end
