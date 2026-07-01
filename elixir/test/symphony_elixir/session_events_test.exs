defmodule SymphonyElixir.SessionEventsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.SessionEvents

  setup do
    workspace = Path.join(System.tmp_dir!(), "session-events-#{System.unique_integer()}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)
    {:ok, workspace: workspace}
  end

  test "append_worker_crash writes message and stack trace", %{workspace: workspace} do
    exception = %RuntimeError{message: "connection refused"}
    stacktrace = [{__MODULE__, :__info__, 1, []}]

    assert :ok = SessionEvents.append_worker_crash(workspace, exception, stacktrace)

    assert {:ok, [entry], _} = SessionEvents.tail(workspace)
    assert entry["title"] == "Worker crashed"
    assert entry["body"] =~ "connection refused"
    assert entry["body"] =~ "Stack trace:"
    assert entry["abort_reason"] == "worker_crash"
  end

  test "append_abort writes a UI-facing turn aborted entry", %{workspace: workspace} do
    assert :ok = SessionEvents.append_abort(workspace, "user_stop", detail: "Stopped manually via hard reset")

    assert {:ok, [entry], _} = SessionEvents.tail(workspace)
    assert entry["title"] == "Turn aborted"
    assert entry["body"] =~ "Reason: user_stop"
    assert entry["body"] =~ "Stopped manually via hard reset"
    assert entry["abort_reason"] == "user_stop"
  end

  test "tail and read_from stream appended entries", %{workspace: workspace} do
    assert :ok = SessionEvents.append_abort(workspace, "stall_timeout", detail: "No activity")

    assert {:ok, tailed, offset} = SessionEvents.tail(workspace)
    assert length(tailed) == 1
    assert offset > 0

    assert :ok = SessionEvents.append_abort(workspace, "worker_exit", detail: "Process died")

    assert {:ok, appended, new_offset} = SessionEvents.read_from(workspace, offset)
    assert new_offset > offset
    assert length(appended) == 1
    assert hd(appended)["abort_reason"] == "worker_exit"
  end
end
