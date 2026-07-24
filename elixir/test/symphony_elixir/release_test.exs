defmodule SymphonyElixir.ReleaseTest do
  use ExUnit.Case, async: false

  test "release configuration includes ERTS, Unix scripts, and tar packaging" do
    config = SymphonyElixir.MixProject.project()
    release = config[:releases][:symphony]

    assert release[:include_erts] == true
    assert release[:include_executables_for] == [:unix]
    assert :assemble in release[:steps]
    assert :tar in release[:steps]
  end

  test "release daemon launcher delegates argv without shell interpolation" do
    script = File.read!("rel/overlays/bin/symphony-daemon")

    assert script =~ "Release.daemon(System.argv())"
    assert script =~ ~s(exec "$release_root/bin/symphony" eval)
    refute script =~ "sh -c"
  end

  test "installed environment is parsed as data before management commands" do
    root = Path.join(System.tmp_dir!(), "release-env-#{System.unique_integer([:positive])}")
    path = Path.join(root, "symphony.env")
    previous = System.get_env("SYMPHONY_TRACKER_PORT")

    on_exit(fn ->
      File.rm_rf!(root)

      if previous do
        System.put_env("SYMPHONY_TRACKER_PORT", previous)
      else
        System.delete_env("SYMPHONY_TRACKER_PORT")
      end
    end)

    File.mkdir_p!(root)
    File.write!(path, "SYMPHONY_TRACKER_PORT=\"43210\"\n")

    assert :ok = SymphonyElixir.Release.load_installed_environment(path)
    assert System.get_env("SYMPHONY_TRACKER_PORT") == "43210"

    File.write!(path, "SYMPHONY_BAD=$(touch /tmp/escape)\n")
    assert {:error, :invalid} = SymphonyElixir.Release.load_installed_environment(path)
  end
end
