defmodule SymphonyElixir.Evidence.Manifest do
  @moduledoc """
  Reads and validates `.symphony/evidence/manifest.json` written by the agent.
  Validation is structural (fields, types, artifact files exist on disk);
  the gate decision lives in `SymphonyElixir.Evidence.Gate`.
  """

  @enforce_keys [:issue, :runs]
  defstruct [:issue, :generated_at, ui_change: false, runs: []]

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
    case Enum.flat_map(runs, &run_issues/1) do
      [] ->
        {:ok,
         %__MODULE__{
           issue: decoded["issue"],
           generated_at: decoded["generated_at"],
           ui_change: decoded["ui_change"] == true,
           runs: Enum.map(runs, &to_run/1)
         }}

      issues ->
        {:error, {:manifest_invalid, issues}}
    end
  end

  defp build(_decoded), do: {:error, {:manifest_invalid, "missing runs list"}}

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
