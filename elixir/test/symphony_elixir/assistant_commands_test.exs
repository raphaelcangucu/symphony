defmodule SymphonyElixir.AssistantCommandsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AssistantCommands

  setup do
    previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)
    tmp_dir = tmp_dir!()
    skills_root = Path.join(tmp_dir, "skills")

    write_skill!(skills_root, "commit", skill_with_front_matter("Commit helper", "Create commit messages."))
    write_skill!(skills_root, "debug", "# Debug skill\n")

    write_skill!(
      Path.join(skills_root, "superpowers"),
      "subagent-driven-development",
      skill_with_front_matter("Subagent flow", "Run subagent-driven execution.")
    )

    write_skill!(
      Path.join(skills_root, "superpowers"),
      "brainstorming",
      skill_with_front_matter("Brainstorming", "Design before implementation.")
    )

    Application.put_env(:symphony_elixir, :skills_root, skills_root)

    on_exit(fn ->
      restore_skills_root(previous_skills_root)
      File.rm_rf!(tmp_dir)
    end)

    :ok
  end

  test "list/1 returns built-ins and execution skills with authoring-only excluded" do
    commands = AssistantCommands.list("execution")

    assert_builtin(commands, "goal")
    assert_builtin(commands, "infer")
    assert_builtin(commands, "btw")

    assert %{
             slug: "commit",
             name: "Commit helper",
             description: "Create commit messages.",
             kind: "skill",
             category: "workflow",
             source: "skills",
             submit_kind: nil
           } = find_command(commands, "commit")

    assert %{
             slug: "debug",
             name: "debug",
             description: "",
             kind: "skill",
             category: "workflow",
             source: "skills",
             submit_kind: nil
           } = find_command(commands, "debug")

    assert %{
             slug: "subagent-driven-development",
             category: "superpowers",
             source: "skills"
           } = find_command(commands, "subagent-driven-development")

    assert find_command(commands, "brainstorming") == nil
  end

  test "list/1 in authoring context includes all superpowers" do
    commands = AssistantCommands.list("authoring")

    assert %{
             slug: "brainstorming",
             name: "Brainstorming",
             description: "Design before implementation.",
             category: "superpowers"
           } = find_command(commands, "brainstorming")
  end

  test "list/0 defaults to execution context" do
    commands = AssistantCommands.list()

    assert find_command(commands, "brainstorming") == nil
  end

  defp assert_builtin(commands, slug) do
    assert %{
             slug: ^slug,
             name: ^slug,
             kind: "builtin",
             category: "builtin",
             source: "builtin",
             submit_kind: ^slug
           } = find_command(commands, slug)
  end

  defp find_command(commands, slug), do: Enum.find(commands, &(&1.slug == slug))

  defp skill_with_front_matter(name, description) do
    """
    ---
    name: #{name}
    description: #{description}
    ---
    # #{name}
    """
  end

  defp tmp_dir! do
    dir = Path.join(System.tmp_dir!(), "assistant-commands-test-#{System.unique_integer([:positive])}")
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
