defmodule SymphonyElixir.Evidence.StoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    {:ok, project} = Context.ensure_project(%{name: "GAM", slug: "gam"})

    workspace = Path.join(tmp_dir, "ws")
    evidence_dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))

    File.write!(
      Path.join(evidence_dir, "manifest.json"),
      Jason.encode!(%{"issue" => "GAM-9", "runs" => []})
    )

    File.write!(Path.join(evidence_dir, "artifacts/s.png"), "img")

    %{project: project, workspace: workspace, evidence_root: Path.join(tmp_dir, "durable")}
  end

  test "persist copies artifacts and stores the record", ctx do
    manifest = %{
      "issue" => "GAM-9",
      "ui_change" => true,
      "runs" => [%{"kind" => "unit", "repo" => "frontend", "status" => "passed"}]
    }

    assert {:ok, record} =
             Store.persist(ctx.project.slug, "GAM-9", ctx.workspace, manifest,
               session_id: "thread-turn",
               evidence_root: ctx.evidence_root
             )

    assert record.run_id != nil
    assert record.status == "passed"
    assert record.ui_change
    assert record.session_id == "thread-turn"
    assert File.exists?(Path.join(record.artifact_dir, "artifacts/s.png"))

    assert {:ok, [listed]} = Store.list(ctx.project.slug, "GAM-9")
    assert listed.id == record.id
  end

  test "failed runs mark the record as failed", ctx do
    manifest = %{
      "issue" => "GAM-9",
      "runs" => [%{"kind" => "unit", "repo" => "frontend", "status" => "failed"}]
    }

    assert {:ok, record} =
             Store.persist(ctx.project.slug, "GAM-9", ctx.workspace, manifest, evidence_root: ctx.evidence_root)

    assert record.status == "failed"
  end

  test "supplementary failed full-suite run does not fail the record when targeted unit passed", ctx do
    manifest = %{
      "issue" => "GAM-9",
      "runs" => [
        %{"kind" => "unit", "repo" => "frontend", "status" => "failed"},
        %{"kind" => "unit", "repo" => "frontend", "status" => "passed"}
      ]
    }

    assert {:ok, record} =
             Store.persist(ctx.project.slug, "GAM-9", ctx.workspace, manifest, evidence_root: ctx.evidence_root)

    assert record.status == "passed"
  end

  test "delete_run removes the record and artifact directory", ctx do
    {:ok, record} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    assert File.exists?(Path.join(record.artifact_dir, "artifacts/s.png"))

    assert {:ok, deleted} = Store.delete_run("gam", "GAM-9", record.run_id)
    assert deleted.id == record.id
    refute File.exists?(record.artifact_dir)
    assert {:ok, []} = Store.list("gam", "GAM-9")
  end

  test "delete_failed removes only non-passing records", ctx do
    {:ok, passed} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit", "status" => "passed"}]},
        evidence_root: ctx.evidence_root
      )

    {:ok, failed} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit", "status" => "failed"}]},
        evidence_root: ctx.evidence_root
      )

    assert {:ok, 1} = Store.delete_failed("gam", "GAM-9")
    assert {:ok, [remaining]} = Store.list("gam", "GAM-9")
    assert remaining.run_id == passed.run_id
    refute File.exists?(failed.artifact_dir)
  end

  test "unknown project is an error", ctx do
    assert {:error, _reason} =
             Store.persist("nope", "GAM-9", ctx.workspace, %{"runs" => []}, evidence_root: ctx.evidence_root)
  end

  test "resolve_artifact rejects path traversal", ctx do
    manifest = %{"issue" => "GAM-9", "runs" => []}

    {:ok, record} =
      Store.persist(ctx.project.slug, "GAM-9", ctx.workspace, manifest, evidence_root: ctx.evidence_root)

    assert {:ok, path} = Store.resolve_artifact(record, "artifacts/s.png")
    assert File.read!(path) == "img"
    assert {:error, :invalid_path} = Store.resolve_artifact(record, "../../etc/passwd")
    assert {:error, :not_found} = Store.resolve_artifact(record, "artifacts/missing.png")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
