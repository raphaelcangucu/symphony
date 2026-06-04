defmodule SymphonyElixir.EditorTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.Editor

  setup do
    previous_status_fun = Application.get_env(:symphony_elixir, :editor_status_fun)

    on_exit(fn ->
      restore_status_fun(previous_status_fun)
    end)

    :ok
  end

  describe "editor_target/2" do
    test "returns {:error, :disabled} when the editor is disabled" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      put_status_fun(fn -> :ready end)

      assert Editor.editor_target("project", "MAC-1") == {:error, :disabled}
    end

    test "returns {:error, :starting} when the editor server is still starting" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :starting end)

      assert Editor.editor_target("project", "MAC-1") == {:error, :starting}
    end

    test "returns {:error, :workspace_missing} when enabled and ready but the dir is absent" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
      File.rm_rf(path)
      refute File.dir?(path)

      assert Editor.editor_target("project", "MAC-EXISTS") == {:error, :workspace_missing}
    end

    test "returns {:ok, url} and strips a leading # when enabled, ready, and the dir exists" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
      File.mkdir_p!(path)
      on_exit(fn -> File.rm_rf(path) end)

      expected_url =
        SymphonyElixir.Config.editor_base_url() <> "/?folder=" <> URI.encode_www_form(path)

      assert Editor.editor_target("project", "MAC-EXISTS") == {:ok, expected_url}
      assert Editor.editor_target("project", "#MAC-EXISTS") == {:ok, expected_url}
    end

    test "opens a repo subdirectory when the workspace root is not buildable" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      workspace = SymphonyElixir.Workspace.path_for_issue("MAC-REPO")
      repo = Path.join(workspace, "repo")
      File.mkdir_p!(repo)
      File.write!(Path.join(repo, "package.json"), "{}")
      on_exit(fn -> File.rm_rf(workspace) end)

      expected_url =
        SymphonyElixir.Config.editor_base_url() <> "/?folder=" <> URI.encode_www_form(repo)

      assert Editor.editor_target("project", "MAC-REPO") == {:ok, expected_url}
    end

    test "opens a multi-root .code-workspace file when front and back exist" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      workspace = SymphonyElixir.Workspace.path_for_issue("MAC-MULTI")
      front = Path.join(workspace, "front")
      back = Path.join(workspace, "back")
      File.mkdir_p!(front)
      File.mkdir_p!(back)
      File.write!(Path.join(front, "package.json"), "{}")
      File.write!(Path.join(back, "composer.json"), "{}")
      on_exit(fn -> File.rm_rf(workspace) end)

      workspace_file = Path.join(workspace, ".symphony/editor.code-workspace")

      expected_url =
        SymphonyElixir.Config.editor_base_url() <>
          "/?workspace=" <> URI.encode_www_form(workspace_file)

      assert Editor.editor_target("project", "MAC-MULTI") == {:ok, expected_url}
      assert File.regular?(workspace_file)

      {:ok, contents} = File.read(workspace_file)
      decoded = Jason.decode!(contents)

      assert Enum.sort_by(decoded["folders"], & &1["name"]) == [
               %{"name" => "back", "path" => back},
               %{"name" => "front", "path" => front}
             ]
    end

    test "includes docs as an additional root when a multi-root workspace has docs" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      workspace = SymphonyElixir.Workspace.path_for_issue("MAC-MULTI-DOCS")
      front = Path.join(workspace, "front")
      back = Path.join(workspace, "back")
      docs = Path.join(workspace, "docs")
      File.mkdir_p!(front)
      File.mkdir_p!(back)
      File.mkdir_p!(docs)
      File.write!(Path.join(front, "package.json"), "{}")
      File.write!(Path.join(back, "composer.json"), "{}")
      on_exit(fn -> File.rm_rf(workspace) end)

      workspace_file = Path.join(workspace, ".symphony/editor.code-workspace")

      expected_url =
        SymphonyElixir.Config.editor_base_url() <>
          "/?workspace=" <> URI.encode_www_form(workspace_file)

      assert Editor.editor_target("project", "MAC-MULTI-DOCS") == {:ok, expected_url}
      assert File.regular?(workspace_file)

      {:ok, contents} = File.read(workspace_file)
      decoded = Jason.decode!(contents)

      assert Enum.sort_by(decoded["folders"], & &1["name"]) == [
               %{"name" => "back", "path" => back},
               %{"name" => "docs", "path" => docs},
               %{"name" => "front", "path" => front}
             ]
    end

    test "opens a workspace file when a single repo subdirectory has workspace docs" do
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      workspace = SymphonyElixir.Workspace.path_for_issue("MAC-REPO-DOCS")
      repo = Path.join(workspace, "repo")
      docs = Path.join(workspace, "docs")
      File.mkdir_p!(repo)
      File.mkdir_p!(docs)
      File.write!(Path.join(repo, "package.json"), "{}")
      on_exit(fn -> File.rm_rf(workspace) end)

      workspace_file = Path.join(workspace, ".symphony/editor.code-workspace")

      expected_url =
        SymphonyElixir.Config.editor_base_url() <>
          "/?workspace=" <> URI.encode_www_form(workspace_file)

      assert Editor.editor_target("project", "MAC-REPO-DOCS") == {:ok, expected_url}
      assert File.regular?(workspace_file)

      {:ok, contents} = File.read(workspace_file)
      decoded = Jason.decode!(contents)

      assert decoded["folders"] == [
               %{"name" => "repo", "path" => repo},
               %{"name" => "docs", "path" => docs}
             ]
    end

    test "prepares workspace skills before returning the editor URL" do
      previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)
      load_workflow_with_front_matter(editor_front_matter())
      enable_editor!()
      put_status_fun(fn -> :ready end)

      path = SymphonyElixir.Workspace.path_for_issue("MAC-SKILLS")
      skills_root = Path.join(path, "_skills")
      File.mkdir_p!(path)
      write_skill!(Path.join(skills_root, "superpowers"), "brainstorming")
      Application.put_env(:symphony_elixir, :skills_root, skills_root)

      on_exit(fn ->
        restore_skills_root(previous_skills_root)
        File.rm_rf(path)
      end)

      expected_url =
        SymphonyElixir.Config.editor_base_url() <> "/?folder=" <> URI.encode_www_form(path)

      assert Editor.editor_target("project", "MAC-SKILLS") == {:ok, expected_url}
      assert File.regular?(Path.join([path, ".codex", "skills", "brainstorming", "SKILL.md"]))
      assert File.regular?(Path.join([path, ".claude", "skills", "brainstorming", "SKILL.md"]))
    end
  end

  describe "cursor_desktop_target/2" do
    test "returns {:error, :workspace_missing} when the workspace is absent" do
      path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
      File.rm_rf(path)
      refute File.dir?(path)

      assert Editor.cursor_desktop_target("project", "MAC-EXISTS") == {:error, :workspace_missing}
    end

    test "returns a cursor:// URL when the workspace exists (no server-side Cursor CLI check)" do
      path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
      File.mkdir_p!(path)
      on_exit(fn -> File.rm_rf(path) end)

      expanded = Path.expand(path)
      previous_wsl = System.get_env("WSL_DISTRO_NAME")
      System.delete_env("WSL_DISTRO_NAME")
      on_exit(fn -> restore_env("WSL_DISTRO_NAME", previous_wsl) end)

      expected_url = "cursor://file/" <> URI.encode(expanded)

      assert Editor.cursor_desktop_target("project", "MAC-EXISTS") == {:ok, expected_url}
    end

    test "returns a vscode-remote WSL URL when running inside WSL" do
      path = SymphonyElixir.Workspace.path_for_issue("MAC-WSL")
      File.mkdir_p!(path)
      on_exit(fn -> File.rm_rf(path) end)

      expanded = Path.expand(path)
      previous_wsl = System.get_env("WSL_DISTRO_NAME")
      System.put_env("WSL_DISTRO_NAME", "Ubuntu")
      on_exit(fn -> restore_env("WSL_DISTRO_NAME", previous_wsl) end)

      expected_url = "cursor://vscode-remote/wsl+ubuntu" <> expanded

      assert Editor.cursor_desktop_target("project", "MAC-WSL") == {:ok, expected_url}
    end
  end

  defp editor_front_matter do
    """
    github:
      repo: acme/app
    editor:
      enabled: true
      base_url: https://editor.example.com
    """
  end

  defp enable_editor! do
    previous_enabled = Application.get_env(:symphony_elixir, :editor_enabled)
    previous_base_url = Application.get_env(:symphony_elixir, :editor_base_url)

    Application.put_env(:symphony_elixir, :editor_enabled, true)
    Application.put_env(:symphony_elixir, :editor_base_url, "https://editor.example.com")

    on_exit(fn ->
      restore_editor_env(:editor_enabled, previous_enabled)
      restore_editor_env(:editor_base_url, previous_base_url)
    end)

    :ok
  end

  defp restore_editor_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_editor_env(key, value), do: Application.put_env(:symphony_elixir, key, value)

  defp put_status_fun(fun) do
    Application.put_env(:symphony_elixir, :editor_status_fun, fun)
  end

  defp restore_status_fun(nil), do: Application.delete_env(:symphony_elixir, :editor_status_fun)
  defp restore_status_fun(fun), do: Application.put_env(:symphony_elixir, :editor_status_fun, fun)

  defp write_skill!(root, name) do
    dir = Path.join(root, name)
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "SKILL.md"), "# #{name}\n")
  end

  defp restore_skills_root(nil), do: Application.delete_env(:symphony_elixir, :skills_root)
  defp restore_skills_root(value), do: Application.put_env(:symphony_elixir, :skills_root, value)

  defp load_workflow_with_front_matter(front_matter) do
    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)
    :ok
  end
end
