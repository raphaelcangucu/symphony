defmodule SymphonyElixir.BootInstanceConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.BootInstanceConfig

  @workflow_path Path.join(System.tmp_dir!(), "boot_instance_config_test_workflow.md")

  setup do
    saved_editor_enabled = System.get_env("SYMPHONY_EDITOR_ENABLED")
    saved_workflow = System.get_env("SYMPHONY_WORKFLOW")

    on_exit(fn ->
      restore_env("SYMPHONY_EDITOR_ENABLED", saved_editor_enabled)
      restore_env("SYMPHONY_WORKFLOW", saved_workflow)
      File.rm(@workflow_path)
    end)

    System.delete_env("SYMPHONY_EDITOR_ENABLED")
    System.delete_env("SYMPHONY_WORKFLOW")
    :ok
  end

  test "reads editor.enabled from WORKFLOW.md when SYMPHONY_EDITOR_ENABLED is unset" do
    File.write!(@workflow_path, """
    ---
    editor:
      enabled: true
      port: 8443
    ---

    prompt
    """)

    System.put_env("SYMPHONY_WORKFLOW", @workflow_path)

    settings = BootInstanceConfig.editor_settings()
    assert Keyword.fetch!(settings, :editor_enabled) == true
    assert Keyword.fetch!(settings, :editor_port) == 8443
  end

  test "SYMPHONY_EDITOR_ENABLED=false overrides workflow editor.enabled" do
    File.write!(@workflow_path, """
    ---
    editor:
      enabled: true
    ---

    prompt
    """)

    System.put_env("SYMPHONY_WORKFLOW", @workflow_path)
    System.put_env("SYMPHONY_EDITOR_ENABLED", "false")

    assert Keyword.fetch!(BootInstanceConfig.editor_settings(), :editor_enabled) == false
  end

  test "SYMPHONY_EDITOR_ENABLED=true overrides workflow editor.enabled false" do
    File.write!(@workflow_path, """
    ---
    editor:
      enabled: false
    ---

    prompt
    """)

    System.put_env("SYMPHONY_WORKFLOW", @workflow_path)
    System.put_env("SYMPHONY_EDITOR_ENABLED", "true")

    assert Keyword.fetch!(BootInstanceConfig.editor_settings(), :editor_enabled) == true
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      v -> System.put_env(key, v)
    end
  end
end
