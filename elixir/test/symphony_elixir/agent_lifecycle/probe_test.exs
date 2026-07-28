defmodule SymphonyElixir.AgentLifecycle.ProbeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentLifecycle.Probe

  test "PATH discovery excludes the Symphony-managed candidate" do
    root = Path.join(System.tmp_dir!(), "agent-probe-#{System.unique_integer([:positive])}")
    managed_dir = Path.join(root, "managed")
    path_dir = Path.join(root, "path")
    managed = executable!(managed_dir, "codex", "codex 1.0.0")
    path_binary = executable!(path_dir, "codex", "codex 2.0.0")

    on_exit(fn -> File.rm_rf(root) end)

    assert {:ok, result} =
             Probe.path("codex",
               managed_path: managed,
               path_env: Enum.join([managed_dir, path_dir], path_separator())
             )

    assert result.path == path_binary
    assert result.version == "codex 2.0.0"
  end

  test "probe reports a non-executable candidate as unavailable" do
    root = Path.join(System.tmp_dir!(), "agent-probe-#{System.unique_integer([:positive])}")
    path = Path.join(root, "codex")
    File.mkdir_p!(root)
    File.write!(path, "#!/bin/sh\nprintf 'codex 1.0.0\\n'\n")
    on_exit(fn -> File.rm_rf(root) end)

    assert {:error, :not_executable} = Probe.executable("codex", path)
  end

  defp executable!(dir, name, version) do
    File.mkdir_p!(dir)
    path = Path.join(dir, name)
    File.write!(path, "#!/bin/sh\nprintf '#{version}\\n'\n")
    File.chmod!(path, 0o755)
    path
  end

  defp path_separator, do: if(match?({:win32, _}, :os.type()), do: ";", else: ":")
end
