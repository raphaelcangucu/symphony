defmodule SymphonyElixir.ReleaseTest do
  use ExUnit.Case, async: true

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
end
