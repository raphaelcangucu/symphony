defmodule SymphonyElixir.Codex.SessionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Codex.Session

  @thread_id "019e7191-fd28-7ec2-b53a-c4195e15147b"

  @tag :tmp_dir
  test "writes a sidecar and resolves the thread id from it", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "workspace")
    File.mkdir_p!(workspace)

    assert :ok = Session.write(workspace, @thread_id)
    assert File.exists?(Path.join(workspace, ".symphony/codex-session.json"))
    assert {:ok, @thread_id} = Session.resolve(workspace)
  end

  @tag :tmp_dir
  test "ignores blank thread ids", %{tmp_dir: tmp_dir} do
    assert :ok = Session.write(tmp_dir, "")
    refute File.exists?(Path.join(tmp_dir, ".symphony/codex-session.json"))
  end

  @tag :tmp_dir
  test "resolves by scanning rollout cwd and backfills the sidecar", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "code/clouapp/front/501")
    File.mkdir_p!(workspace)

    sessions_dir = Path.join(tmp_dir, "codex-sessions/2026/05/28")
    File.mkdir_p!(sessions_dir)

    rollout = Path.join(sessions_dir, "rollout-2026-05-28T23-30-53-#{@thread_id}.jsonl")

    meta =
      Jason.encode!(%{
        "type" => "session_meta",
        "payload" => %{"id" => @thread_id, "cwd" => Path.expand(workspace), "originator" => "symphony-orchestrator"}
      })

    File.write!(rollout, meta <> "\n" <> Jason.encode!(%{"type" => "event"}) <> "\n")

    assert {:ok, @thread_id} =
             Session.resolve(workspace, sessions_dir: Path.join(tmp_dir, "codex-sessions"))

    # Backfilled for next time, so a sidecar-only resolve now succeeds.
    assert {:ok, @thread_id} = Session.resolve(workspace, sessions_dir: Path.join(tmp_dir, "empty"))
  end

  @tag :tmp_dir
  test "does not match rollouts from a different workspace", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "code/clouapp/front/501")
    File.mkdir_p!(workspace)

    sessions_dir = Path.join(tmp_dir, "codex-sessions/2026/05/28")
    File.mkdir_p!(sessions_dir)

    rollout = Path.join(sessions_dir, "rollout-2026-05-28T23-30-53-#{@thread_id}.jsonl")

    meta =
      Jason.encode!(%{
        "type" => "session_meta",
        "payload" => %{"id" => @thread_id, "cwd" => "/some/other/workspace"}
      })

    File.write!(rollout, meta <> "\n")

    assert :error = Session.resolve(workspace, sessions_dir: Path.join(tmp_dir, "codex-sessions"))
  end

  @tag :tmp_dir
  test "returns :error when nothing is found", %{tmp_dir: tmp_dir} do
    assert :error = Session.resolve(tmp_dir, sessions_dir: Path.join(tmp_dir, "missing"))
  end
end
