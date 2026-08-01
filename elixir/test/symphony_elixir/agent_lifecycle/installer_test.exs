defmodule SymphonyElixir.AgentLifecycle.InstallerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentLifecycle.{Installer, Paths, RuntimeRegistry}

  setup do
    root = Path.join(System.tmp_dir!(), "agent-installer-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:symphony_elixir, :agent_data_dir)
    Application.put_env(:symphony_elixir, :agent_data_dir, root)
    RuntimeRegistry.reset()

    on_exit(fn ->
      File.rm_rf(root)
      RuntimeRegistry.reset()

      if previous do
        Application.put_env(:symphony_elixir, :agent_data_dir, previous)
      else
        Application.delete_env(:symphony_elixir, :agent_data_dir)
      end
    end)

    {:ok, root: root}
  end

  test "installs an executable, probes it, and atomically records current" do
    artifact = shell_script("codex 1.2.3")

    assert {:ok, %{status: :activated, version: "1.2.3", executable_path: executable}} =
             install("codex", "1.2.3", artifact)

    assert File.exists?(executable)
    assert executable?(executable)
    assert {output, 0} = System.cmd(executable, ["--version"])
    assert String.trim(output) == "codex 1.2.3"

    assert {:ok, manifest} = Installer.current("codex")
    assert manifest["version"] == "1.2.3"
    assert manifest["executable_path"] == executable
    assert File.exists?(Paths.current_manifest("codex"))
  end

  test "rejects a checksum mismatch without publishing an install" do
    artifact = shell_script("codex 1.2.3")

    assert {:error, :checksum_mismatch} =
             Installer.install(
               "codex",
               %{version: "1.2.3", url: "memory://codex", checksum: String.duplicate("0", 64), format: :raw},
               download: fn _url -> {:ok, artifact} end
             )

    assert Installer.current("codex") == {:error, :not_installed}
    refute File.exists?(Paths.version_root("codex", "1.2.3"))
  end

  test "failed post-install probe rolls back and preserves current" do
    assert {:ok, %{status: :activated}} = install("codex", "1.0.0", shell_script("codex 1.0.0"))
    assert {:ok, before} = Installer.current("codex")

    assert {:error, {:probe_failed, :broken}} =
             install("codex", "2.0.0", shell_script("codex 2.0.0"), probe: fn _agent, _path -> {:error, :broken} end)

    assert Installer.current("codex") == {:ok, before}
    refute File.exists?(Paths.version_root("codex", "2.0.0"))
  end

  test "defers activation while a session is active and activates after release" do
    assert {:ok, %{status: :activated}} = install("codex", "1.0.0", shell_script("codex 1.0.0"))
    assert {:ok, current} = Installer.current("codex")
    assert {:ok, lease, _pinned} = RuntimeRegistry.acquire("codex", current)

    assert {:ok, %{status: :deferred, version: "2.0.0"}} =
             install("codex", "2.0.0", shell_script("codex 2.0.0"))

    assert {:ok, %{"version" => "1.0.0"}} = Installer.current("codex")
    assert {:ok, %{"version" => "2.0.0"}} = Installer.pending("codex")
    assert :ok = RuntimeRegistry.release(lease)

    assert {:ok, %{status: :activated, version: "2.0.0"}} = Installer.activate_pending("codex")
    assert {:ok, %{"version" => "2.0.0"}} = Installer.current("codex")
    assert Installer.pending("codex") == {:error, :none}
  end

  test "extracts a GitHub tarball and records an upstream-unpublished checksum", %{root: root} do
    archive = tar_gz!(root, "opencode", shell_script("opencode 1.2.3"))

    assert {:ok, %{status: :activated, version: "1.2.3", executable_path: executable}} =
             Installer.install(
               "opencode",
               %{
                 version: "1.2.3",
                 url: "memory://opencode",
                 checksum: nil,
                 format: :tar_gz,
                 binary_entry: "opencode"
               },
               download: fn _url -> {:ok, archive} end
             )

    assert {output, 0} = System.cmd(executable, ["--version"])
    assert String.trim(output) == "opencode 1.2.3"
    assert {:ok, %{"checksum" => checksum, "checksum_verified" => false}} = Installer.current("opencode")
    assert checksum == sha256(archive)
  end

  test "runs Cursor's installer only inside a disposable HOME" do
    installer = """
    #!/bin/sh
    mkdir -p "$HOME/.local/bin"
    printf '#!/bin/sh\\nprintf "cursor-agent 9.8.7\\\\n"\\n' > "$HOME/.local/bin/cursor-agent"
    chmod 755 "$HOME/.local/bin/cursor-agent"
    """

    assert {:ok, %{status: :activated, version: "latest-" <> _hash, executable_path: executable}} =
             Installer.install(
               "cursor",
               %{version: "latest", url: "memory://cursor", checksum: nil, format: :installer},
               download: fn _url -> {:ok, installer} end
             )

    assert {output, 0} = System.cmd(executable, ["--version"])
    assert String.trim(output) == "cursor-agent 9.8.7"
    assert String.starts_with?(executable, Paths.root())
  end

  defp install(agent, version, artifact, options \\ []) do
    release = %{
      version: version,
      url: "memory://#{agent}/#{version}",
      checksum: sha256(artifact),
      format: :raw
    }

    Installer.install(agent, release, Keyword.put(options, :download, fn _url -> {:ok, artifact} end))
  end

  defp shell_script(version), do: "#!/bin/sh\nprintf '#{version}\\n'\n"

  defp sha256(data),
    do: :crypto.hash(:sha256, data) |> Base.encode16(case: :lower)

  defp executable?(path) do
    case File.stat(path) do
      {:ok, %{mode: mode}} -> Bitwise.band(mode, 0o111) != 0
      _ -> false
    end
  end

  defp tar_gz!(root, name, contents) do
    source = Path.join(root, "archive-source")
    archive = Path.join(root, "#{name}.tar.gz")
    File.mkdir_p!(source)
    File.write!(Path.join(source, name), contents)
    {_output, 0} = System.cmd("tar", ["-czf", archive, "-C", source, name])
    File.read!(archive)
  end
end
