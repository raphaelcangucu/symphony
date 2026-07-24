defmodule SymphonyElixir.Daemon.ReleaseSmokeTest do
  use ExUnit.Case, async: false

  @tag timeout: 120_000
  test "production release boots with SQLite, assets, migrations, and skills" do
    release_root = Path.expand("_build/prod/rel/symphony")

    scratch =
      Path.join(
        System.tmp_dir!(),
        "symphony-release-smoke-#{System.unique_integer([:positive, :monotonic])}"
      )

    port = unused_port()
    on_exit(fn -> File.rm_rf!(scratch) end)

    {output, status} =
      System.cmd(
        "sh",
        [
          "test/release/installed_release_test.sh",
          release_root,
          scratch,
          Integer.to_string(port)
        ],
        stderr_to_stdout: true
      )

    assert status == 0, output
  end

  defp unused_port do
    {:ok, socket} =
      :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])

    {:ok, port} = :inet.port(socket)
    :ok = :gen_tcp.close(socket)
    port
  end
end
