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
      put_status_fun(fn -> :starting end)

      assert Editor.editor_target("project", "MAC-1") == {:error, :starting}
    end

    test "returns {:error, :workspace_missing} when enabled and ready but the dir is absent" do
      load_workflow_with_front_matter(editor_front_matter())
      put_status_fun(fn -> :ready end)

      path = SymphonyElixir.Workspace.path_for_issue("MAC-EXISTS")
      File.rm_rf(path)
      refute File.dir?(path)

      assert Editor.editor_target("project", "MAC-EXISTS") == {:error, :workspace_missing}
    end

    test "returns {:ok, url} and strips a leading # when enabled, ready, and the dir exists" do
      load_workflow_with_front_matter(editor_front_matter())
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

  defp put_status_fun(fun) do
    Application.put_env(:symphony_elixir, :editor_status_fun, fun)
  end

  defp restore_status_fun(nil), do: Application.delete_env(:symphony_elixir, :editor_status_fun)
  defp restore_status_fun(fun), do: Application.put_env(:symphony_elixir, :editor_status_fun, fun)

  defp load_workflow_with_front_matter(front_matter) do
    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)

    if Process.whereis(SymphonyElixir.WorkflowStore) do
      SymphonyElixir.WorkflowStore.force_reload()
    end

    :ok
  end
end
