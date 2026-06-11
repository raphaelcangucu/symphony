defmodule SymphonyElixir.PullRequestMonitor.Classifier do
  @moduledoc """
  One-shot LLM judgment for PR monitor events.

  Runs a single read-only agent turn (no dynamic tools, scratch workspace) and
  parses a strict JSON verdict. Every failure path degrades to `needs_human`
  so the monitor never moves an issue to Rework on uncertain output.
  """

  alias SymphonyElixir.CodingAgent
  alias SymphonyElixir.Config

  require Logger

  @confidence_floor 0.6
  @actionable_verdicts ~w(pr_caused fixable_by_agent)
  @valid_verdicts ~w(pr_caused unrelated fixable_by_agent needs_human)
  @fallback %{
    "kind" => "unknown",
    "verdict" => "needs_human",
    "confidence" => 0.0,
    "summary" => "Automatic classification unavailable; defaulting to human review."
  }

  @type verdict :: %{String.t() => term()}
  @type runner :: (String.t(), keyword() -> {:ok, String.t()} | {:error, term()})

  @spec classify(:ci_failure | :review_findings, map(), keyword()) :: {:ok, verdict()}
  def classify(kind, context, opts \\ []) when is_map(context) do
    runner = Keyword.get(opts, :runner, &default_runner/2)
    prompt = build_prompt(kind, context)

    with {:ok, reply} <- safe_run(runner, prompt, opts),
         {:ok, parsed} <- parse_verdict(reply) do
      {:ok, apply_confidence_floor(parsed)}
    else
      {:error, reason} ->
        Logger.debug("PR monitor classification fell back to needs_human reason=#{inspect(reason)}")
        {:ok, @fallback}
    end
  end

  @spec build_prompt(:ci_failure | :review_findings, map()) :: String.t()
  def build_prompt(kind, context) do
    """
    You are a CI/review triage judge for an automated coding agent. Answer with
    your reasoning followed by EXACTLY ONE fenced JSON block:

    ```json
    {"kind": "ci_failure" | "review", "verdict": "...", "confidence": 0.0-1.0, "summary": "1-2 sentences"}
    ```

    Verdict meanings:
    - "pr_caused": the CI failure happens in code/tests touched or directly exercised by this PR's changes.
    - "unrelated": flaky/timeout/infra errors, failures in untouched areas, or pre-existing breakage.
    - "fixable_by_agent": blocking review findings with a clear mechanical fix needing no human decisions.
    - "needs_human": anything requiring human judgment, credentials, or product decisions.

    ## Issue
    #{issue_section(context)}

    ## Pull request
    #{pr_section(context)}

    #{detail_section(kind, context)}
    """
    |> String.trim()
  end

  @spec parse_verdict(String.t()) :: {:ok, verdict()} | {:error, term()}
  def parse_verdict(reply) when is_binary(reply) do
    with [_ | _] = blocks <- Regex.scan(~r/```json\s*(\{.*?\})\s*```/s, reply, capture: :all_but_first),
         [json] <- List.last(blocks),
         {:ok, %{"verdict" => verdict} = decoded} <- Jason.decode(json),
         true <- verdict in @valid_verdicts do
      {:ok, decoded}
    else
      _ -> {:error, :invalid_verdict}
    end
  end

  @spec apply_confidence_floor(verdict()) :: verdict()
  defp apply_confidence_floor(%{"verdict" => verdict} = decoded) when verdict in @actionable_verdicts do
    case decoded["confidence"] do
      confidence when is_number(confidence) and confidence >= @confidence_floor ->
        decoded

      _ ->
        Map.merge(decoded, %{
          "verdict" => "needs_human",
          "summary" => low_confidence_summary(decoded)
        })
    end
  end

  defp apply_confidence_floor(decoded), do: decoded

  defp low_confidence_summary(decoded) do
    "Low-confidence classification (#{inspect(decoded["confidence"])}): #{decoded["summary"]}"
  end

  @spec safe_run(runner(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  defp safe_run(runner, prompt, opts) do
    runner.(prompt, opts)
  rescue
    exception -> {:error, exception}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  @spec default_runner(String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  defp default_runner(prompt, opts) do
    workspace = scratch_workspace()
    issue = %{id: "pr-monitor", identifier: "pr-monitor", title: "PR monitor classification"}

    with :ok <- File.mkdir_p(workspace) do
      try do
        with {:ok, session} <-
               CodingAgent.start_session(workspace, nil,
                 dynamic_tools: [],
                 tool_executor: fn _tool, _arguments -> {:error, :no_tools_for_pr_monitor} end
               ) do
          {:ok, collector} = Agent.start_link(fn -> "" end)

          try do
            on_message = fn message ->
              append_collected_delta(collector, message)
            end

            run_turn_opts =
              opts
              |> Keyword.take([:agent_kind, :model, :effort, :attachments, :codex_config, :goal, :max_goal_turns])
              |> Keyword.put(:turn_timeout_ms, 120_000)
              |> Keyword.put(:on_message, on_message)

            case CodingAgent.run_turn(session, prompt, issue, run_turn_opts) do
              {:ok, _result} ->
                {:ok, Agent.get(collector, & &1)}

              {:error, reason} ->
                {:error, reason}
            end
          after
            Agent.stop(collector)
            CodingAgent.stop_session(session, nil)
          end
        end
      after
        _ = File.rm_rf(workspace)
      end
    end
  end

  @spec append_collected_delta(pid(), map()) :: :ok
  defp append_collected_delta(collector, message) when is_pid(collector) and is_map(message) do
    payload = payload_from_message(message)
    delta = payload_delta(payload)

    if is_binary(delta) and delta != "" do
      Agent.update(collector, fn acc -> acc <> delta end)
    end

    :ok
  end

  defp append_collected_delta(_collector, _message), do: :ok

  @spec payload_from_message(map()) :: map()
  defp payload_from_message(message) do
    Map.get(message, :payload) || Map.get(message, "payload") || %{}
  end

  @spec payload_delta(map()) :: String.t() | nil
  defp payload_delta(payload) do
    case payload_method(payload) do
      "item/agentMessage/delta" ->
        params_value(payload, "delta")

      "item/created" ->
        created_item_text(payload)

      _other ->
        nil
    end
  end

  @spec payload_method(map()) :: String.t() | nil
  defp payload_method(payload) do
    Map.get(payload, "method") || Map.get(payload, :method)
  end

  @spec created_item_text(map()) :: String.t() | nil
  defp created_item_text(payload) do
    item = params_value(payload, "item") || %{}

    if item_type(item) == "text" do
      Map.get(item, "text") || Map.get(item, :text)
    else
      nil
    end
  end

  @spec item_type(map()) :: String.t() | nil
  defp item_type(item) do
    Map.get(item, "type") || Map.get(item, :type)
  end

  @spec params_value(map(), String.t()) :: term()
  defp params_value(payload, key) do
    atom_key =
      case key do
        "delta" -> :delta
        "item" -> :item
      end

    get_in(payload, ["params", key]) || get_in(payload, [:params, atom_key])
  end

  @spec scratch_workspace() :: Path.t()
  defp scratch_workspace do
    unique_id = System.unique_integer([:positive]) |> Integer.to_string()
    Path.join([Config.workspace_root(), "_pr_monitor", "classifier-" <> unique_id])
  end

  @spec issue_section(map()) :: String.t()
  defp issue_section(%{issue: issue}) do
    "Identifier: #{issue[:identifier]}\nTitle: #{issue[:title]}\nDescription: #{truncate(issue[:description], 2_000)}"
  end

  defp issue_section(_context), do: "(unknown issue)"

  @spec pr_section(map()) :: String.t()
  defp pr_section(%{pr: pr}) do
    files =
      pr
      |> Map.get(:changed_files, [])
      |> Enum.take(50)
      |> Enum.join("\n- ")

    "##{pr[:number]} - #{pr[:title]}\nBranch: #{pr[:head_ref]} -> #{pr[:base_ref]}\nChanged files:\n- #{files}"
  end

  defp pr_section(_context), do: "(unknown PR)"

  @spec detail_section(:ci_failure | :review_findings, map()) :: String.t()
  defp detail_section(:ci_failure, %{failing_jobs: jobs}) do
    sections =
      Enum.map_join(jobs, "\n\n", fn job ->
        "### #{job[:name]}\n```log\n#{truncate(job[:excerpt] || "(log unavailable)", 8_192)}\n```"
      end)

    "## Failing CI jobs\n#{sections}"
  end

  defp detail_section(:review_findings, %{review: review}) do
    "## Review findings (state: #{review[:state]}, author: #{review[:author]})\n#{truncate(review[:body], 8_192)}"
  end

  defp detail_section(_kind, _context), do: ""

  @spec truncate(String.t() | nil, non_neg_integer()) :: String.t()
  defp truncate(nil, _max), do: ""
  defp truncate(text, max) when is_binary(text), do: String.slice(text, 0, max)
end
