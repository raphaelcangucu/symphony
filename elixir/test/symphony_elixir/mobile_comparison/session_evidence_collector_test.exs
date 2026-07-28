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

  test "targets the requested terminal thread instead of a newer active thread", %{
    tmp_dir: tmp_dir
  } do
    terminal = Path.join(tmp_dir, "terminal")
    active = Path.join(tmp_dir, "active")

    for workspace <- [terminal, active] do
      evidence_dir = Path.join(workspace, ".symphony/evidence")
      File.mkdir_p!(evidence_dir)

      File.write!(
        Path.join(evidence_dir, "manifest.json"),
        Jason.encode!(%{
          "issue" => "DEV-2",
          "runs" => [
            %{
              "kind" => "unit",
              "repo" => "site",
              "command" => "node --test",
              "status" => "passed",
              "workspace" => workspace
            }
          ]
        })
      )
    end

    Process.put({FakeHistory, :threads}, [
      %{id: 12, status: "closed", workspace_path: terminal},
      %{id: 13, status: "active", workspace_path: active}
    ])

    Process.put({FakeStore, :test_pid}, self())

    assert :ok =
             SessionEvidenceCollector.collect("dev10x", "DEV-2", %{
               comparison_history: FakeHistory,
               comparison_evidence_store: FakeStore,
               comparison_session_id: 12
             })

    assert_receive {:persist, "dev10x", "DEV-2", ^terminal, _manifest, opts}
    assert opts[:session_id] == "assistant-thread:12"
    refute_receive {:persist, "dev10x", "DEV-2", ^active, _manifest, _opts}
  end
end
