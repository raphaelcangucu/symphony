defmodule SymphonyElixir.GitHub.CheckLogs do
  @moduledoc """
  Fetches a GitHub Actions job log and extracts a cleaned tail excerpt suitable
  for embedding in an issue comment. Failure summaries reliably sit at the end of
  Actions logs, so a tail (timestamp/ANSI stripped, line + char capped) captures
  the relevant error region.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  @max_lines 200
  @max_chars 8_000

  @spec failing_job_excerpt(String.t(), pos_integer(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def failing_job_excerpt(repo, job_id, opts \\ [])
      when is_binary(repo) and is_integer(job_id) and job_id > 0 do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      client = Keyword.get(opts, :client_module, default_client())
      rest_opts = Keyword.take(opts, [:request_fun])
      path = "/repos/#{owner}/#{name}/actions/jobs/#{job_id}/logs"

      case client.rest_get(path, rest_opts) do
        {:ok, %{body: body}} when is_binary(body) -> {:ok, clean_and_tail(body)}
        {:ok, %{body: _other}} -> {:error, :unexpected_log_body}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @spec clean_and_tail(String.t()) :: String.t()
  def clean_and_tail(raw) when is_binary(raw) do
    raw
    |> String.split(["\r\n", "\n"])
    |> Enum.map(&strip_timestamp/1)
    |> Enum.map(&strip_ansi/1)
    |> Enum.take(-@max_lines)
    |> Enum.join("\n")
    |> cap_chars()
    |> String.trim()
  end

  defp strip_timestamp(line), do: Regex.replace(~r/^\S+T\S+Z\s/, line, "")
  defp strip_ansi(line), do: Regex.replace(~r/\e\[[0-9;]*m/, line, "")

  defp cap_chars(text) do
    if String.length(text) <= @max_chars do
      text
    else
      String.slice(text, -@max_chars, @max_chars)
    end
  end

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
