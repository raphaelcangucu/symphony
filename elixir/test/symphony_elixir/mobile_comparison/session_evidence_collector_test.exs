defmodule SymphonyElixir.MobileComparison.SessionEvidenceCollectorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.SessionEvidenceCollector

  @moduletag :tmp_dir

  defmodule FakeHistory do
    def list_threads(_opts), do: Process.get({__MODULE__, :threads}, [])
  end

  defmodule FakeStore do
    def persist(project_slug, identifier, workspace, manifest, opts) do
      send(
        Process.get({__MODULE__, :test_pid}),
        {:persist, project_slug, identifier, workspace, manifest, opts}
      )

      {:ok, %{run_id: "durable-session-run"}}
    end
  end

  test "promotes the latest valid issue-session manifest with an idempotent session key", %{
    tmp_dir: tmp_dir
  } do
    older = Path.join(tmp_dir, "older")
    current = Path.join(tmp_dir, "current")
    evidence_dir = Path.join(current, ".symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))
    File.write!(Path.join(evidence_dir, "artifacts/home.png"), "png")

    manifest = %{
      "issue" => "DEV-2",
      "ui_change" => true,
      "runs" => [
        %{
          "kind" => "e2e",
          "repo" => "site",
          "command" => "npm run test:e2e",
          "status" => "passed",
          "screenshots" => [%{"path" => "artifacts/home.png"}]
        }
      ]
    }

    File.write!(Path.join(evidence_dir, "manifest.json"), Jason.encode!(manifest))

    Process.put({FakeHistory, :threads}, [
      %{id: 11, workspace_path: older},
      %{id: 12, workspace_path: current}
    ])

    Process.put({FakeStore, :test_pid}, self())

    assert :ok =
             SessionEvidenceCollector.collect("dev10x", "DEV-2", %{
               comparison_history: FakeHistory,
               comparison_evidence_store: FakeStore
             })

    assert_receive {:persist, "dev10x", "DEV-2", ^current, ^manifest, opts}
    assert opts[:evidence_dir] == evidence_dir
    assert opts[:idempotent] == true
    assert opts[:session_id] == "assistant-thread:12"
  end
end
