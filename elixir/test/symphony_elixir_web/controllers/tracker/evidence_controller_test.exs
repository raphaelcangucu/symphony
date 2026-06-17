defmodule SymphonyElixirWeb.Tracker.EvidenceControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, project} = Context.ensure_project(%{name: "GAM", slug: "gam"})

    workspace = Path.join(tmp_dir, "ws")
    evidence_dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))

    File.write!(
      Path.join(evidence_dir, "manifest.json"),
      Jason.encode!(%{"issue" => "GAM-9", "runs" => []})
    )

    File.write!(Path.join(evidence_dir, "artifacts/s.png"), "imgbytes")

    %{project: project, workspace: workspace, evidence_root: Path.join(tmp_dir, "durable")}
  end

  test "index returns empty data when no evidence persisted" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence")
    assert %{"data" => []} = json_response(conn, 200)
  end

  test "index lists persisted evidence with manifest", ctx do
    manifest = %{
      "issue" => "GAM-9",
      "ui_change" => true,
      "runs" => [%{"kind" => "unit", "repo" => "frontend", "status" => "passed"}]
    }

    {:ok, record} =
      Store.persist("gam", "GAM-9", ctx.workspace, manifest, evidence_root: ctx.evidence_root)

    conn = get(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence")

    assert %{"data" => [entry]} = json_response(conn, 200)
    assert entry["run_id"] == record.run_id
    assert entry["status"] == "passed"
    assert entry["ui_change"] == true
    assert [%{"kind" => "unit"}] = entry["manifest"]["runs"]
  end

  test "index for unknown project renders not found" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/nope/issues/GAM-9/evidence")
    assert %{"error" => %{"code" => "project_not_found"}} = json_response(conn, 404)
  end

  test "clear removes all evidence for an issue", ctx do
    {:ok, _one} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    {:ok, _two} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    conn = delete(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence")
    assert %{"data" => %{"deleted" => 2}} = json_response(conn, 200)
    assert %{"data" => []} = json_response(get(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence"), 200)
  end

  test "delete run removes a single evidence record", ctx do
    {:ok, record} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    conn =
      delete(
        authorized_conn(),
        "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/#{record.run_id}"
      )

    assert conn.status == 204
    assert %{"data" => []} = json_response(get(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence"), 200)
  end

  test "clear_failed removes only non-passing records", ctx do
    {:ok, passed} =
      Store.persist(
        "gam",
        "GAM-9",
        ctx.workspace,
        %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit", "status" => "passed"}]},
        evidence_root: ctx.evidence_root
      )

    {:ok, _failed} =
      Store.persist(
        "gam",
        "GAM-9",
        ctx.workspace,
        %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit", "status" => "failed"}]},
        evidence_root: ctx.evidence_root
      )

    conn = post(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/clear-failed")
    assert %{"data" => %{"deleted" => 1}} = json_response(conn, 200)

    assert %{"data" => [entry]} =
             json_response(get(authorized_conn(), "/api/tracker/v1/projects/gam/issues/GAM-9/evidence"), 200)

    assert entry["run_id"] == passed.run_id
  end

  test "artifact route serves the file bytes with content type", ctx do
    {:ok, record} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/#{record.run_id}/artifacts/artifacts/s.png"
      )

    assert conn.status == 200
    assert response_content_type(conn, :png) =~ "image/png"
    assert conn.resp_body == "imgbytes"
  end

  test "artifact route rejects traversal and unknown paths", ctx do
    {:ok, record} =
      Store.persist("gam", "GAM-9", ctx.workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: ctx.evidence_root)

    traversal =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/#{record.run_id}/artifacts/..%2F..%2Fetc%2Fpasswd"
      )

    assert traversal.status in [404, 422]

    missing =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/#{record.run_id}/artifacts/artifacts/none.png"
      )

    assert %{"error" => %{"code" => "artifact_not_found"}} = json_response(missing, 404)

    unknown_run =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/none/artifacts/artifacts/s.png"
      )

    assert %{"error" => %{"code" => "evidence_run_not_found"}} = json_response(unknown_run, 404)
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
