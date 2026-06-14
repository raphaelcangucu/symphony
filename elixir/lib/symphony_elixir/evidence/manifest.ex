defmodule SymphonyElixir.Evidence.Manifest do
  @moduledoc """
  Reads and validates `.symphony/evidence/manifest.json` written by the agent.
  Validation is structural (fields, types, artifact files exist on disk);
  the gate decision lives in `SymphonyElixir.Evidence.Gate`.
  """

  @enforce_keys [:issue, :runs]
  defstruct [:issue, :generated_at, ui_change: false, runs: [], impact: []]

  defmodule Run do
    @moduledoc false
    @enforce_keys [:kind, :repo, :command, :status]
    defstruct [
      :kind,
      :repo,
      :command,
      :status,
      :summary,
      :report,
      :duration_ms,
      screenshots: [],
      videos: [],
      trace: nil
    ]

    @type t :: %__MODULE__{}
  end

  @type t :: %__MODULE__{}

  @evidence_dir ".symphony/evidence"
  @required_run_fields ~w(kind repo command status)

  @spec dir(Path.t()) :: Path.t()
  def dir(workspace), do: Path.join(workspace, @evidence_dir)

  @spec read(Path.t()) ::
          {:ok, t()}
          | {:error, :manifest_missing | {:manifest_invalid, term()} | {:artifacts_missing, [String.t()]}}
  def read(workspace) do
    path = Path.join(dir(workspace), "manifest.json")

    with {:ok, raw} <- read_file(path),
         {:ok, decoded} <- decode(raw),
         {:ok, manifest} <- build(decoded),
         :ok <- verify_artifacts(workspace, manifest) do
      {:ok, manifest}
    end
  end

  @spec artifact_paths(t()) :: [String.t()]
  def artifact_paths(%__MODULE__{runs: runs}) do
    Enum.flat_map(runs, fn run ->
      Enum.filter([run.report, run.trace], &is_binary/1) ++ run.screenshots ++ run.videos
    end)
  end

  defp read_file(path) do
    case File.read(path) do
      {:ok, raw} -> {:ok, raw}
      {:error, :enoent} -> {:error, :manifest_missing}
      {:error, reason} -> {:error, {:manifest_invalid, reason}}
    end
  end

  defp decode(raw) do
    case Jason.decode(raw) do
      {:ok, decoded} when is_map(decoded) -> {:ok, decoded}
      {:ok, _other} -> {:error, {:manifest_invalid, "manifest must be a JSON object"}}
      {:error, reason} -> {:error, {:manifest_invalid, reason}}
    end
  end

  defp build(%{"runs" => runs} = decoded) when is_list(runs) do
    case Enum.flat_map(runs, &run_issues/1) ++ impact_issues(decoded["impact"]) do
      [] ->
        {:ok,
         %__MODULE__{
           issue: decoded["issue"],
           generated_at: decoded["generated_at"],
           ui_change: decoded["ui_change"] == true,
           runs: Enum.map(runs, &to_run/1),
           impact: to_impact(decoded["impact"])
         }}

      issues ->
        {:error, {:manifest_invalid, issues}}
    end
  end

  defp build(_decoded), do: {:error, {:manifest_invalid, "missing runs list"}}

  # `impact` is the agent's per-source-repo cross-repo decision: whether a change
  # in repo `from` impacts the UI repo `to`. Optional, but when present each
  # entry must be well-formed, and a `false` decision must carry a rationale so
  # the skip is auditable rather than silent.
  defp impact_issues(nil), do: []
  defp impact_issues(entries) when is_list(entries), do: Enum.flat_map(entries, &impact_entry_issues/1)
  defp impact_issues(_other), do: ["impact must be a list"]

  defp impact_entry_issues(%{} = entry) do
    from_to_issues(entry) ++ impacts_ui_issues(entry)
  end

  defp impact_entry_issues(_entry), do: ["impact entries must be objects"]

  defp from_to_issues(entry) do
    ["from", "to"]
    |> Enum.reject(&present_string?(entry[&1]))
    |> Enum.map(&"impact entry missing required field: #{&1}")
  end

  defp impacts_ui_issues(%{"impacts_ui" => impacts_ui} = entry) when is_boolean(impacts_ui) do
    if impacts_ui == false and not present_string?(entry["rationale"]) do
      ["impact entry #{entry["from"]} -> #{entry["to"]} with impacts_ui=false must include a rationale"]
    else
      []
    end
  end

  defp impacts_ui_issues(_entry), do: ["impact entry impacts_ui must be a boolean"]

  defp present_string?(value), do: is_binary(value) and String.trim(value) != ""

  defp to_impact(entries) when is_list(entries), do: Enum.map(entries, &to_impact_entry/1)
  defp to_impact(_entries), do: []

  defp to_impact_entry(entry) do
    %{
      from: entry["from"],
      to: entry["to"],
      impacts_ui: entry["impacts_ui"] == true,
      rationale: entry["rationale"]
    }
  end

  defp run_issues(run) when is_map(run) do
    @required_run_fields
    |> Enum.reject(&is_binary(run[&1]))
    |> Enum.map(&"run missing required field: #{&1}")
  end

  defp run_issues(_run), do: ["run entries must be objects"]

  defp to_run(run) do
    %Run{
      kind: run["kind"],
      repo: run["repo"],
      command: run["command"],
      status: run["status"],
      summary: run["summary"],
      report: run["report"],
      duration_ms: run["duration_ms"],
      screenshots: List.wrap(run["screenshots"]),
      videos: List.wrap(run["videos"]),
      trace: run["trace"]
    }
  end

  defp verify_artifacts(workspace, manifest) do
    base = dir(workspace)

    missing =
      manifest
      |> artifact_paths()
      |> Enum.reject(fn rel ->
        full = Path.join(base, rel)
        File.exists?(full) or File.dir?(String.trim_trailing(full, "/"))
      end)

    case missing do
      [] -> :ok
      missing -> {:error, {:artifacts_missing, missing}}
    end
  end
end
