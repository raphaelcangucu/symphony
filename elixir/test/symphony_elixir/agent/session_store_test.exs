defmodule SymphonyElixir.Agent.SessionStoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.SessionStore

  test "transcript_path is namespaced by session id under the workspace" do
    path = SessionStore.transcript_path("/tmp/tree", 8015)
    assert path == "/tmp/tree/.symphony/sessions/8015/transcript.jsonl"
  end

  test "append writes one NDJSON line to the session's own file" do
    workspace = Path.join(System.tmp_dir!(), "sessstore-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    :ok = SessionStore.append(workspace, 42, %{"type" => "assistant", "text" => "hi"})
    :ok = SessionStore.append(workspace, 43, %{"type" => "assistant", "text" => "other"})

    p42 = SessionStore.transcript_path(workspace, 42)
    p43 = SessionStore.transcript_path(workspace, 43)

    assert File.read!(p42) =~ "hi"
    refute File.read!(p42) =~ "other"
    assert File.read!(p43) =~ "other"
  end

  test "tail and read_from stream normalized entries from the owned transcript" do
    workspace = Path.join(System.tmp_dir!(), "sessstore-stream-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    :ok = SessionStore.append(workspace, 44, %{"type" => "assistant", "text" => "first"})

    path = SessionStore.transcript_path(workspace, 44)
    assert {:ok, [%{"text" => "first"}], offset} = SessionStore.tail(path)

    :ok = SessionStore.append(workspace, 44, %{"type" => "assistant", "text" => "second"})

    assert {:ok, [%{"text" => "second"}], next_offset} =
             SessionStore.read_from(path, offset)

    assert next_offset > offset
  end
end
