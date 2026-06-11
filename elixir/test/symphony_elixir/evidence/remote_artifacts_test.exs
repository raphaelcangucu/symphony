defmodule SymphonyElixir.Evidence.RemoteArtifactsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.RemoteArtifacts
  alias SymphonyElixir.Evidence.Store
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    {:ok, _project} = Context.ensure_project(%{name: "GAM", slug: "gam"})

    workspace = Path.join(tmp_dir, "ws")
    evidence_dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(Path.join(evidence_dir, "artifacts"))
    File.write!(Path.join(evidence_dir, "manifest.json"), Jason.encode!(%{"issue" => "GAM-9", "runs" => []}))
    File.write!(Path.join(evidence_dir, "artifacts/s.png"), "img-bytes")

    {:ok, record} =
      Store.persist("gam", "GAM-9", workspace, %{"issue" => "GAM-9", "runs" => []}, evidence_root: Path.join(tmp_dir, "durable"))

    url =
      "http://localhost:4000/api/tracker/v1/projects/gam/issues/GAM-9/evidence/#{record.run_id}/artifacts/artifacts/s.png"

    %{record: record, url: url}
  end

  test "contains_artifacts? detects the Symphony artifact route", %{url: url} do
    assert RemoteArtifacts.contains_artifacts?("![s.png](#{url})")
    refute RemoteArtifacts.contains_artifacts?("no artifacts here")
  end

  test "rewrite_markdown swaps the Symphony URL for the uploaded asset, keeping markdown", %{url: url} do
    uploader = fn path, filename, _ct ->
      assert File.read!(path) == "img-bytes"
      {:ok, "https://uploads.linear.app/#{filename}"}
    end

    body = "## Codex Evidence\n\n![s.png](#{url})\n"
    rewritten = RemoteArtifacts.rewrite_markdown(body, "linear", uploader)

    assert rewritten =~ "![s.png](https://uploads.linear.app/s.png)"
    refute rewritten =~ "/api/tracker/v1/"
  end

  test "rewrite_markdown keeps the original URL when the artifact can't be resolved" do
    missing =
      "http://localhost:4000/api/tracker/v1/projects/gam/issues/GAM-9/evidence/nope/artifacts/artifacts/s.png"

    body = "![s.png](#{missing})"
    uploader = fn _p, _f, _c -> flunk("uploader must not run for unresolved artifacts") end

    assert RemoteArtifacts.rewrite_markdown(body, "linear", uploader) == body
  end

  test "upload_cached uploads once per content hash and reuses the cached ref", %{url: url} do
    counter = :counters.new(1, [])

    uploader = fn _path, filename, _ct ->
      :counters.add(counter, 1, 1)
      {:ok, "https://uploads.linear.app/#{filename}"}
    end

    body = "![s.png](#{url})"

    assert RemoteArtifacts.rewrite_markdown(body, "linear", uploader) =~ "uploads.linear.app/s.png"
    assert RemoteArtifacts.rewrite_markdown(body, "linear", uploader) =~ "uploads.linear.app/s.png"

    assert :counters.get(counter, 1) == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
