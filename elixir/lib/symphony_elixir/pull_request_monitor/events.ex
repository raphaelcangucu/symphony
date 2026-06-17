defmodule SymphonyElixir.PullRequestMonitor.Events do
  @moduledoc """
  Pure detection of actionable PR events against the persisted monitor state.

  Order matters: merged > ci_failure > review_findings > none. Each event is
  identified by a stable fingerprint/marker so it is consumed exactly once.
  """

  alias SymphonyElixir.PullRequestMonitor.MonitorState

  @type event ::
          :merged
          | {:ci_failure, String.t()}
          | {:review_findings, String.t()}
          | :none

  @failure_conclusions ~w(FAILURE TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED)
  @failing_rollups ~w(FAILURE ERROR)
  @symphony_headers [
    "## CI failure",
    "## Review feedback",
    "## PR merged",
    "## Codex Workpad",
    "## Evidence",
    "## Automatic fix limit reached",
    "## PR feedback"
  ]

  @spec detect(map(), MonitorState.t() | nil) :: event()
  def detect(pr, row) when is_map(pr) do
    if merged_event?(pr, row), do: :merged, else: detect_ci_or_review(pr, row)
  end

  @spec checks_fingerprint(map()) :: String.t() | nil
  def checks_fingerprint(pr) when is_map(pr) do
    case failing_jobs(pr) do
      [] ->
        nil

      jobs ->
        payload =
          [Map.get(pr, :head_sha) || "" | Enum.sort(Enum.map(jobs, &"#{&1[:name]}:#{&1[:conclusion]}"))]
          |> Enum.join("|")

        :crypto.hash(:sha256, payload) |> Base.encode16(case: :lower)
    end
  end

  @spec failing_jobs(map()) :: [map()]
  def failing_jobs(pr) when is_map(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(&Map.get(&1, :jobs, []))
    |> Enum.filter(&failing_job?/1)
  end

  defp detect_ci_or_review(pr, row) do
    case ci_failure_event(pr, row) do
      {:ci_failure, _fp} = event -> event
      :none -> review_event(pr, row)
    end
  end

  @merged_terminal_actions ~w(moved_to_done merged_awaiting_others)

  defp merged_event?(pr, row) do
    Map.get(pr, :merged) == true and last_action(row) not in @merged_terminal_actions
  end

  defp ci_failure_event(pr, row) do
    with true <- Map.get(pr, :state) in ["open", "draft"],
         true <- rollup_failing?(pr),
         false <- any_job_running?(pr),
         fp when is_binary(fp) <- checks_fingerprint(pr),
         true <- fp != last_fingerprint(row) do
      {:ci_failure, fp}
    else
      _ -> :none
    end
  end

  defp review_event(pr, row) do
    pr
    |> Map.get(:conversation, [])
    |> Enum.filter(&candidate_review_entry?(&1, Map.get(pr, :author)))
    |> Enum.map(& &1[:created_at])
    |> Enum.reject(&is_nil/1)
    |> Enum.max(fn -> nil end)
    |> case do
      nil -> :none
      marker -> if newer?(marker, last_marker(row)), do: {:review_findings, marker}, else: :none
    end
  end

  defp candidate_review_entry?(entry, pr_author) do
    author = entry[:author]
    body = entry[:body] || ""

    author != nil and author != pr_author and
      not Enum.any?(@symphony_headers, &String.starts_with?(body, &1))
  end

  defp newer?(marker, nil), do: is_binary(marker)

  defp newer?(marker, last) when is_binary(marker) and is_binary(last) do
    case {DateTime.from_iso8601(marker), DateTime.from_iso8601(last)} do
      {{:ok, marker_dt, _}, {:ok, last_dt, _}} ->
        DateTime.compare(marker_dt, last_dt) == :gt

      _ ->
        marker > last
    end
  end

  defp newer?(_, _), do: false

  defp rollup_failing?(pr) do
    rollup = pr |> Map.get(:checks_state) |> to_string() |> String.upcase()
    rollup in @failing_rollups or failing_jobs(pr) != []
  end

  defp any_job_running?(pr) do
    pr
    |> Map.get(:pipelines, [])
    |> Enum.flat_map(&Map.get(&1, :jobs, []))
    |> Enum.any?(fn job ->
      String.upcase(to_string(job[:status] || "")) in ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"]
    end)
  end

  defp failing_job?(job) do
    String.upcase(to_string(job[:conclusion] || "")) in @failure_conclusions
  end

  defp last_action(nil), do: nil
  defp last_action(%MonitorState{last_action: action}), do: action

  defp last_fingerprint(nil), do: nil
  defp last_fingerprint(%MonitorState{last_checks_fingerprint: fp}), do: fp

  defp last_marker(nil), do: nil
  defp last_marker(%MonitorState{last_review_marker: marker}), do: marker
end
