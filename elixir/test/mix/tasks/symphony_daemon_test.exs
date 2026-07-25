defmodule Mix.Tasks.Symphony.DaemonTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Daemon, as: Task

  test "parse delegates the daemon command contract" do
    assert {:ok, {:status, %{json: true}}} = Task.parse(["status", "--json"])
  end

  test "prepare_argv builds and selects the release artifact when omitted" do
    test_pid = self()

    assert {:ok, ["install", "--force", "--artifact", "/tmp/symphony.tar.gz"]} =
             Task.prepare_argv(["install", "--force"],
               build_release: fn ->
                 send(test_pid, :release_built)
                 :ok
               end,
               artifact_path: fn -> "/tmp/symphony.tar.gz" end
             )

    assert_received :release_built
  end

  test "prepare_argv preserves an explicit artifact without building" do
    assert {:ok, argv} =
             Task.prepare_argv(["install", "--artifact", "/tmp/custom.tar.gz"],
               build_release: fn -> flunk("release should not be built") end
             )

    assert argv == ["install", "--artifact", "/tmp/custom.tar.gz"]
  end

  test "default artifact name includes target OS and architecture" do
    architecture = :erlang.system_info(:system_architecture) |> to_string() |> String.split("-") |> hd()
    assert Task.default_artifact_path() =~ "-linux-#{architecture}.tar.gz"
  end
end
