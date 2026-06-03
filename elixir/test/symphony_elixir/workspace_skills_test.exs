defmodule SymphonyElixir.WorkspaceSkillsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.WorkspaceSkills

  setup do
    previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)
    tmp_dir = tmp_dir!()
    workspace = Path.join(tmp_dir, "workspace")
    skills_root = Path.join(tmp_dir, "skills")

    File.mkdir_p!(workspace)
    write_skill!(skills_root, "commit", "# Commit\n")
    write_skill!(Path.join(skills_root, "superpowers"), "brainstorming", "# Brainstorming\n")

    Application.put_env(:symphony_elixir, :skills_root, skills_root)

    on_exit(fn ->
      restore_skills_root(previous_skills_root)
      File.rm_rf!(tmp_dir)
    end)

    {:ok, workspace: workspace, skills_root: skills_root}
  end

  test "creates discoverable Codex and Claude skills links with flattened superpowers", %{workspace: workspace} do
    assert :ok = WorkspaceSkills.prepare(workspace)

    assert File.regular?(Path.join([workspace, ".codex", "skills", "commit", "SKILL.md"]))
    assert File.regular?(Path.join([workspace, ".claude", "skills", "commit", "SKILL.md"]))
    assert File.regular?(Path.join([workspace, ".codex", "skills", "brainstorming", "SKILL.md"]))
    assert File.regular?(Path.join([workspace, ".claude", "skills", "brainstorming", "SKILL.md"]))
  end

  test "is idempotent", %{workspace: workspace} do
    assert :ok = WorkspaceSkills.prepare(workspace)
    assert :ok = WorkspaceSkills.prepare(workspace)

    assert File.regular?(Path.join([workspace, ".codex", "skills", "brainstorming", "SKILL.md"]))
  end

  test "populates an existing agent skills directory without replacing it", %{workspace: workspace} do
    existing_skills = Path.join([workspace, ".codex", "skills"])
    File.mkdir_p!(existing_skills)

    assert :ok = WorkspaceSkills.prepare(workspace)

    assert File.dir?(existing_skills)
    assert File.regular?(Path.join([existing_skills, "brainstorming", "SKILL.md"]))
    assert File.regular?(Path.join([workspace, ".claude", "skills", "brainstorming", "SKILL.md"]))
  end

  test "adds local excludes and skills links for repository roots inside the workspace", %{workspace: workspace} do
    front = Path.join(workspace, "front")
    File.mkdir_p!(Path.join(front, ".git/info"))
    File.write!(Path.join(front, ".git/info/exclude"), "# existing\n")

    assert :ok = WorkspaceSkills.prepare(workspace)

    assert File.regular?(Path.join([front, ".codex", "skills", "brainstorming", "SKILL.md"]))
    assert File.regular?(Path.join([front, ".claude", "skills", "brainstorming", "SKILL.md"]))

    exclude = File.read!(Path.join(front, ".git/info/exclude"))
    assert exclude =~ "/.codex/"
    assert exclude =~ "/.claude/"
  end

  test "returns a clear error when a file blocks an agent configuration directory", %{workspace: workspace} do
    blocked_path = Path.join(workspace, ".codex")
    File.write!(blocked_path, "not a directory")

    assert {:error, {:blocked_path, ^blocked_path}} = WorkspaceSkills.prepare(workspace)
  end

  defp tmp_dir! do
    dir = Path.join(System.tmp_dir!(), "workspace-skills-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(dir)
    File.mkdir_p!(dir)
    dir
  end

  defp write_skill!(root, name, body) do
    dir = Path.join(root, name)
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "SKILL.md"), body)
  end

  defp restore_skills_root(nil), do: Application.delete_env(:symphony_elixir, :skills_root)
  defp restore_skills_root(value), do: Application.put_env(:symphony_elixir, :skills_root, value)
end
