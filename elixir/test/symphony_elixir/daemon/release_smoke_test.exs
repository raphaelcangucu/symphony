defmodule SymphonyElixir.Daemon.ReleaseSmokeTest do
  use ExUnit.Case, async: false

  @tag timeout: 120_000
  test "production release boots with SQLite, assets, migrations, and skills" do
    scratch =
      Path.join(
        System.tmp_dir!(),
        "symphony-release-smoke-#{System.unique_integer([:positive, :monotonic])}"
      )

    architecture = :erlang.system_info(:system_architecture) |> to_string() |> String.split("-") |> hd()
    artifact = Path.expand("_build/prod/symphony-0.3.0-linux-#{architecture}.tar.gz")
    release_root = Path.join(scratch, "release")
    port = unused_port()
    on_exit(fn -> File.rm_rf!(scratch) end)

    File.mkdir_p!(release_root)

    assert :ok =
             :erl_tar.extract(
               String.to_charlist(artifact),
               [:compressed, {:cwd, String.to_charlist(release_root)}]
             )

    refute File.exists?(Path.join(release_root, "mix.exs"))
    refute File.exists?(Path.join(release_root, "deps"))
    refute File.exists?(Path.join(release_root, "_build"))

    source_skills_root = Path.expand("../../../../skills", __DIR__)

    source_skills =
      source_skills_root
      |> File.ls!()
      |> Enum.filter(&File.dir?(Path.join(source_skills_root, &1)))
      |> Enum.sort()

    packaged_skills =
      Path.join(release_root, "lib/symphony_elixir-0.3.0/priv/skills")
      |> File.ls!()
      |> Enum.filter(&File.dir?(Path.join(release_root, "lib/symphony_elixir-0.3.0/priv/skills/#{&1}")))
      |> Enum.sort()

    assert packaged_skills == source_skills

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
