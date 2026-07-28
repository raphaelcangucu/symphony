defmodule SymphonyElixir.MobileRpc.Methods.EvidenceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.MobileRpc.{Dispatcher, EvidenceService}
  alias SymphonyElixir.MobileRpc.Methods.Evidence
  alias SymphonyElixir.Repo

  @moduletag :tmp_dir

  defmodule FakeEvidenceService do
    def call("evidence.list", %{"project_slug" => "dev10x", "identifier" => "DEV-1"}, _context) do
      {:ok, %{"records" => [%{"run_id" => "run-1"}]}}
    end

    def call(
          "evidence.artifact.read",
          %{
            "project_slug" => "dev10x",
            "identifier" => "DEV-1",
            "run_id" => "run-1",
            "path" => "artifacts/s.png",
            "offset" => 0,
            "length" => 4
          },
          _context
        ) do
      {:ok,
       %{
         "content" => Base.encode64("PNG!"),
         "content_type" => "image/png",
         "size" => 8,
         "offset" => 0,
         "next_offset" => 4,
         "eof" => false
       }}
    end
  end

  defmodule FakeSessionEvidenceCollector do
    def collect(project_slug, identifier, context) do
      send(context.test_pid, {:collected_session_evidence, project_slug, identifier})
      :ok
    end
  end

  defmodule FakeOrchestratorService do
    def list_executions do
      [
        %{
          issue_identifier: "GAM-1",
          session_id: "native-run-1",
          execution_session_id: 91,
          agent_kind: "codex",
          requested_model: "gpt-5.6-sol",
          requested_effort: "high",
          resolved_model: "gpt-5.6-sol",
          resolved_effort: "high"
        }
      ]
    end
  end

  setup %{tmp_dir: tmp_dir} do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    {:ok, _project} = Context.ensure_project(%{name: "GAM", slug: "gam"})

    workspace = Path.join(tmp_dir, "workspace")
    evidence_dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))
    File.write!(Path.join(evidence_dir, "artifacts/s.png"), "PNG!rest")

    manifest = %{
      "issue" => "GAM-1",
      "ui_change" => true,
      "runs" => [
        %{
          "kind" => "e2e",
          "repo" => "site",
          "command" => "npm run test:e2e",
          "status" => "passed",
          "screenshots" => [%{"path" => "artifacts/s.png"}]
        }
      ]
    }

    {:ok, record} =
      Store.persist("gam", "GAM-1", workspace, manifest,
        evidence_root: Path.join(tmp_dir, "durable"),
        evidence_dir: evidence_dir,
        run_id: "run-1",
        session_id: "native-run-1"
      )

    %{record: record, tmp_dir: tmp_dir}
  end

  test "registers exact list and bounded artifact methods" do
    assert Enum.map(Evidence.modules(), & &1.name()) == [
             "evidence.list",
             "evidence.artifact.read"
           ]

    assert {:ok, params} =
             Evidence.List.validate(%{
               "project_slug" => "dev10x",
               "identifier" => "DEV-1"
             })

    assert {:ok, %{"records" => [%{"run_id" => "run-1"}]}} =
             Evidence.List.call(params, %{mobile_evidence_service: FakeEvidenceService})

    read_params = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "run_id" => "run-1",
      "path" => "artifacts/s.png",
      "offset" => 0,
      "length" => 4
    }

    assert {:ok, ^read_params} = Evidence.ArtifactRead.validate(read_params)

    assert {:ok, %{"next_offset" => 4, "eof" => false}} =
             Evidence.ArtifactRead.call(read_params, %{
               mobile_evidence_service: FakeEvidenceService
             })
  end

  test "registers evidence capabilities in the default mobile dispatcher" do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        protocol: 1,
        device_id: "device-a",
        connection_pid: self()
      })

    assert Map.has_key?(dispatcher.methods, "evidence.list")
    assert Map.has_key?(dispatcher.methods, "evidence.artifact.read")
  end

  test "rejects unknown keys, negative offsets and oversized chunks" do
    base = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "run_id" => "run-1",
      "path" => "artifacts/s.png",
      "offset" => 0,
      "length" => 4
    }

    assert {:error, :invalid_params} = Evidence.List.validate(Map.put(base, "secret", "no"))

    assert {:error, :invalid_params} =
             Evidence.ArtifactRead.validate(%{base | "offset" => -1})

    assert {:error, :invalid_params} =
             Evidence.ArtifactRead.validate(%{base | "length" => 524_289})
  end

  test "lists durable manifests and reads artifact chunks with EOF metadata" do
    assert {:ok, %{"records" => [record]}} =
             EvidenceService.call(
               "evidence.list",
               %{"project_slug" => "gam", "identifier" => "GAM-1"},
               %{}
             )

    assert record["run_id"] == "run-1"
    assert record["ui_change"] == true
    assert record["manifest"]["issue"] == "GAM-1"

    params = %{
      "project_slug" => "gam",
      "identifier" => "GAM-1",
      "run_id" => "run-1",
      "path" => "artifacts/s.png",
      "offset" => 0,
      "length" => 4
    }

    assert {:ok,
            %{
              "content" => first,
              "content_type" => "image/png",
              "size" => 8,
              "offset" => 0,
              "next_offset" => 4,
              "eof" => false
            }} = EvidenceService.call("evidence.artifact.read", params, %{})

    assert Base.decode64!(first) == "PNG!"

    assert {:ok, %{"content" => rest, "next_offset" => 8, "eof" => true}} =
             EvidenceService.call(
               "evidence.artifact.read",
               %{params | "offset" => 4, "length" => 524_288},
               %{}
             )

    assert Base.decode64!(rest) == "rest"
  end

  test "collects direct-session evidence and presents task-scoped execution provenance" do
    assert {:ok, %{"records" => [record]}} =
             EvidenceService.call(
               "evidence.list",
               %{"project_slug" => "gam", "identifier" => "GAM-1"},
               %{
                 test_pid: self(),
                 mobile_session_evidence_collector: FakeSessionEvidenceCollector,
                 mobile_orchestrator_service: FakeOrchestratorService
               }
             )

    assert_receive {:collected_session_evidence, "gam", "GAM-1"}

    assert record["provenance"] == %{
             "execution_path" => "orchestrator",
             "agent_kind" => "codex",
             "thread_id" => nil,
             "execution_session_id" => 91,
             "requested_model" => "gpt-5.6-sol",
             "requested_effort" => "high",
             "resolved_model" => "gpt-5.6-sol",
             "resolved_effort" => "high"
           }
  end

  test "rejects traversal, symlinks, unknown runs and offsets beyond EOF", %{record: record} do
    base = %{
      "project_slug" => "gam",
      "identifier" => "GAM-1",
      "run_id" => "run-1",
      "path" => "artifacts/s.png",
      "offset" => 0,
      "length" => 4
    }

    assert {:error, {:rpc_error, "invalid_artifact_path", _, false, nil}} =
             EvidenceService.call(
               "evidence.artifact.read",
               %{base | "path" => "../../etc/passwd"},
               %{}
             )

    outside = Path.join(record.artifact_dir, "outside.txt")
    File.write!(outside, "outside")
    File.ln_s!(outside, Path.join(record.artifact_dir, "artifacts/link.txt"))

    assert {:error, {:rpc_error, "invalid_artifact_path", _, false, nil}} =
             EvidenceService.call(
               "evidence.artifact.read",
               %{base | "path" => "artifacts/link.txt"},
               %{}
             )

    assert {:error, {:rpc_error, "evidence_run_not_found", _, false, nil}} =
             EvidenceService.call(
               "evidence.artifact.read",
               %{base | "run_id" => "missing"},
               %{}
             )

    assert {:error, {:rpc_error, "invalid_artifact_offset", _, false, nil}} =
             EvidenceService.call(
               "evidence.artifact.read",
               %{base | "offset" => 9},
               %{}
             )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
