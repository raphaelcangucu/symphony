defmodule SymphonyElixir.Evidence.Judge do
  @moduledoc """
  Independent semantic judge for the VALIDATE gate. Runs a one-shot, no-tools,
  fresh-context model turn over the ticket criteria + git diff + changed test
  files and decides whether the tests actually exercise the change. The verdict
  is cached in `.symphony/evidence/judge.json` keyed by the manifest content hash
  so repeated gate evaluations within a run reuse one model call.

  `build_prompt/1` and `parse_verdict/1` are pure and unit-tested; `verdict/2`
  is tested with an injected `:runner`/`:input_fn`.
  """

  require Logger

  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.Evidence.{GitDiff, Manifest}

  @verdict_file "judge.json"
  @max_file_bytes 20_000

  @system """
  You are an INDEPENDENT validation judge. You did NOT write this code. Decide
  ONLY whether the provided tests actually exercise the change shown in the diff
  and prove the ticket's acceptance criteria. Be strict: a test that does not
  touch the changed code, or that fabricates a page (e.g. page.setContent)
  instead of driving the real flow, must FAIL.

  Respond with a SINGLE JSON object and nothing else:
  {"verdict":"pass"|"fail","reasons":["short reason", ...]}
  """

  @type verdict :: :pass | {:fail, [String.t()]} | :none

  @spec verdict(Path.t(), keyword()) :: verdict()
  def verdict(workspace, opts \\ []) do
    if judge_enabled?(Keyword.get(opts, :config)) do
      run_or_read(workspace, opts)
    else
      :none
    end
  end

  @spec read_verdict(Path.t()) :: verdict()
  def read_verdict(workspace) do
    with {:ok, raw} <- File.read(verdict_path(workspace)),
         {:ok, %{"verdict" => v} = decoded} <- Jason.decode(raw) do
      to_verdict(v, decoded["reasons"])
    else
      _ -> :none
    end
  end

  @spec build_prompt(map()) :: String.t()
  def build_prompt(%{criteria: criteria, diff: diff, test_files: test_files}) do
    """
    #{@system}

    ## Ticket acceptance criteria
    #{blank_to_dash(criteria)}

    ## Change (git diff)
    #{blank_to_dash(diff)}

    ## Test files added/changed
    #{format_test_files(test_files)}

    Return the JSON verdict now.
    """
    |> String.trim()
  end

  @spec parse_verdict(String.t()) :: verdict()
  def parse_verdict(text) when is_binary(text) do
    with [json] <- Regex.run(~r/\{.*\}/s, text),
         {:ok, %{"verdict" => v} = decoded} <- Jason.decode(json) do
      to_verdict(v, decoded["reasons"])
    else
      _ -> :none
    end
  end

  def parse_verdict(_text), do: :none

  defp run_or_read(workspace, opts) do
    hash_fn = Keyword.get(opts, :hash_fn, &manifest_hash/1)
    hash = hash_fn.(workspace)

    case cached(workspace, hash) do
      {:ok, verdict} ->
        verdict

      :miss ->
        input_fn = Keyword.get(opts, :input_fn, fn ws -> judge_input(ws, Keyword.get(opts, :issue)) end)
        runner = Keyword.get(opts, :runner, &default_runner/2)
        prompt = build_prompt(input_fn.(workspace))

        case runner.(workspace, prompt) do
          {:ok, text} ->
            verdict = parse_verdict(text)
            write_verdict(workspace, hash, verdict, text)
            verdict

          {:error, reason} ->
            Logger.warning("Evidence judge unavailable: #{inspect(reason)}")
            :none
        end
    end
  end

  defp judge_enabled?(%{judge: %{enabled: false}}), do: false
  defp judge_enabled?(_config), do: true

  defp to_verdict("pass", _reasons), do: :pass
  defp to_verdict("fail", reasons), do: {:fail, normalize_reasons(reasons)}
  defp to_verdict(_other, _reasons), do: :none

  defp normalize_reasons(reasons) when is_list(reasons), do: Enum.filter(reasons, &is_binary/1)
  defp normalize_reasons(reason) when is_binary(reason), do: [reason]
  defp normalize_reasons(_other), do: []

  defp verdict_path(workspace), do: Path.join(Manifest.dir(workspace), @verdict_file)

  defp manifest_hash(workspace) do
    case File.read(Path.join(Manifest.dir(workspace), "manifest.json")) do
      {:ok, raw} -> :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)
      _ -> "no-manifest"
    end
  end

  defp cached(workspace, hash) do
    with {:ok, raw} <- File.read(verdict_path(workspace)),
         {:ok, %{"manifest_hash" => ^hash, "verdict" => v} = decoded} <- Jason.decode(raw) do
      {:ok, to_verdict(v, decoded["reasons"])}
    else
      _ -> :miss
    end
  end

  defp write_verdict(workspace, hash, verdict, raw_text) do
    {v, reasons} =
      case verdict do
        :pass -> {"pass", []}
        {:fail, reasons} -> {"fail", reasons}
        :none -> {"none", []}
      end

    payload = %{"manifest_hash" => hash, "verdict" => v, "reasons" => reasons, "raw" => raw_text}
    File.mkdir_p!(Manifest.dir(workspace))
    File.write!(verdict_path(workspace), Jason.encode!(payload))
  end

  defp judge_input(workspace, issue) do
    %{criteria: issue_criteria(issue), diff: diff_text(workspace), test_files: changed_test_files(workspace)}
  end

  defp issue_criteria(%{} = issue) do
    [Map.get(issue, :title), Map.get(issue, :description) || Map.get(issue, :body)]
    |> Enum.filter(&is_binary/1)
    |> Enum.join("\n\n")
  end

  defp issue_criteria(_issue), do: ""

  defp diff_text(workspace) do
    workspace
    |> SymphonyElixir.RunContract.repo_states()
    |> Enum.map_join("\n", &repo_diff/1)
  end

  defp repo_diff(%{path: path} = repo) do
    base = Map.get(repo, :default_branch)
    args = if is_binary(base), do: ["diff", "origin/#{base}...HEAD"], else: ["diff", "HEAD"]

    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {out, 0} -> out
      _ -> ""
    end
  end

  defp changed_test_files(workspace) do
    repo_paths =
      workspace
      |> SymphonyElixir.RunContract.repo_states()
      |> Map.new(fn r -> {r.name, r.path} end)

    workspace
    |> GitDiff.changed_files()
    |> Enum.flat_map(fn {repo, files} ->
      base = Map.get(repo_paths, repo)
      files |> Enum.filter(&test_file?/1) |> Enum.map(&{&1, read_capped(base, &1)})
    end)
  end

  defp test_file?(path), do: String.contains?(path, "test") or String.contains?(path, "spec")

  defp read_capped(nil, _rel), do: ""

  defp read_capped(base, rel) do
    case File.read(Path.join(base, rel)) do
      {:ok, content} -> String.slice(content, 0, @max_file_bytes)
      _ -> ""
    end
  end

  defp format_test_files([]), do: "(none changed)"

  defp format_test_files(files) do
    Enum.map_join(files, "\n\n", fn {name, content} -> "### #{name}\n```\n#{content}\n```" end)
  end

  defp blank_to_dash(""), do: "(none provided)"
  defp blank_to_dash(nil), do: "(none provided)"
  defp blank_to_dash(text), do: text

  defp default_runner(workspace, prompt) do
    issue = %{id: "evidence:judge", identifier: "judge", title: "Evidence judge"}
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)
      if is_binary(delta) and delta != "", do: Agent.update(collector, &(&1 <> delta))
    end

    opts = [dynamic_tools: [], tool_executor: fn _t, _a -> {:error, :no_tools} end, on_message: on_message]

    try do
      case CodingAgent.run(workspace, prompt, issue, opts) do
        {:ok, _result} -> {:ok, Agent.get(collector, & &1)}
        {:error, reason} -> {:error, reason}
      end
    after
      Agent.stop(collector)
    end
  end

  defp extract_delta(message) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}

    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"])
  end

  defp extract_delta(_message), do: nil
end
