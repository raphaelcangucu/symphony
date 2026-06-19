defmodule SymphonyElixir.PromptBuilderTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.LocalTracker.{Context, ProjectSetup}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo

  @default_prompt "Ticket {{ issue.identifier }}"

  setup do
    migrate_repo()
    clean_repo()
    seed_project_with_setup("mac", @default_prompt)
    :ok
  end

  test "injects execution methodology and skips authoring skills guidance" do
    issue = %Issue{
      identifier: "MAC-10",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue)

    assert prompt =~ "## Symphony execution mode (orchestrator dispatch)"
    assert prompt =~ "subagent-driven-development" or prompt =~ "Subagent-Driven Development"
    assert prompt =~ "Fresh subagent per task"
    assert prompt =~ "Do **NOT** use `brainstorming`"
    refute prompt =~ "Brainstorming Ideas Into Designs"
  end

  test "execution methodology appears before authoring artifacts in the prompt" do
    root = temporary_workspace_root!("pb-exec-order")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "plans"]))
    File.write!(Path.join([root, "docs", "superpowers", "plans", "plan.md"]), "# Plan")

    issue = %Issue{
      identifier: "MAC-11",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    {exec_pos, _} = :binary.match(prompt, "## Symphony execution mode (orchestrator dispatch)")
    {artifacts_pos, _} = :binary.match(prompt, "## Existing authoring artifacts (follow these)")
    assert exec_pos < artifacts_pos
  end

  test "appends superpowers artifacts when present in the workspace" do
    root = temporary_workspace_root!("pb-artifacts")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))
    File.write!(Path.join([root, "docs", "superpowers", "specs", "x.md"]), "# Spec X")
    File.write!(Path.join([root, "docs", "superpowers", "handoff.md"]), "# Handoff\nkey decisions")

    issue = %Issue{
      identifier: "MAC-1",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    assert prompt =~ "Ticket MAC-1"
    assert prompt =~ "## Existing authoring artifacts (follow these)"
    assert prompt =~ "docs/superpowers/specs/x.md"
    assert prompt =~ "Spec X"
    assert prompt =~ "docs/superpowers/handoff.md"
    assert prompt =~ "Handoff"
    assert prompt =~ "key decisions"
  end

  test "appends no superpowers artifacts without a workspace or docs directory" do
    root = temporary_workspace_root!("pb-no-artifacts")

    issue = %Issue{
      identifier: "MAC-2",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue)

    assert prompt =~ "Ticket MAC-2"
    refute prompt =~ "## Existing authoring artifacts"
    assert prompt =~ "manage_preview"

    assert PromptBuilder.build_prompt(issue, workspace: root) =~ "Ticket MAC-2"
    refute PromptBuilder.build_prompt(issue, workspace: root) =~ "## Existing authoring artifacts"
  end

  test "appends recent discussion comments to the prompt" do
    issue = %Issue{
      identifier: "510",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "Rework",
      comments: [
        %{
          author: "raphael",
          body: "Temos alguns problemas aqui que devem ser corrigidos.",
          created_at: ~U[2026-06-02 03:08:39Z],
          source: "issue"
        }
      ]
    }

    prompt = PromptBuilder.build_prompt(issue)

    assert prompt =~ "Ticket 510"
    assert prompt =~ "## Recent discussion (issue + PR)"
    assert prompt =~ "Temos alguns problemas aqui que devem ser corrigidos."
  end

  test "appends superpowers artifacts in deterministic order and skips oversized files" do
    root = temporary_workspace_root!("pb-ordered-artifacts")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "plans"]))

    File.write!(Path.join([root, "docs", "superpowers", "specs", "b.md"]), "# Spec B")
    File.write!(Path.join([root, "docs", "superpowers", "specs", "a.md"]), "# Spec A")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "b.md"]), "# Plan B")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "a.md"]), "# Plan A")
    File.write!(Path.join([root, "docs", "superpowers", "handoff.md"]), "# Handoff")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "large.md"]), String.duplicate("x", 512_001))

    issue = %Issue{
      identifier: "MAC-3",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    expected_order = [
      "docs/superpowers/specs/a.md",
      "docs/superpowers/specs/b.md",
      "docs/superpowers/plans/a.md",
      "docs/superpowers/plans/b.md",
      "docs/superpowers/plans/large.md",
      "docs/superpowers/handoff.md"
    ]

    positions =
      Enum.map(expected_order, fn relative_path ->
        assert {position, _length} = :binary.match(prompt, relative_path)
        position
      end)

    assert positions == Enum.sort(positions)
    assert prompt =~ "_Skipped: artifact too large._"
    assert prompt =~ "Plan A"
    assert prompt =~ "Spec A"
  end

  test "limits injected artifacts by deterministic aggregate count" do
    root = temporary_workspace_root!("pb-count-budget")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))

    Enum.each(1..22, fn index ->
      padded_index = index |> Integer.to_string() |> String.pad_leading(2, "0")
      File.write!(Path.join([root, "docs", "superpowers", "specs", "#{padded_index}.md"]), "# Spec #{padded_index}")
    end)

    issue = %Issue{
      identifier: "MAC-4",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    assert prompt =~ "docs/superpowers/specs/01.md"
    assert prompt =~ "docs/superpowers/specs/20.md"
    refute prompt =~ "docs/superpowers/specs/21.md"
    refute prompt =~ "Spec 21"
    refute prompt =~ "docs/superpowers/specs/22.md"
    assert prompt =~ "_Skipped 2 additional authoring artifact(s) due to prompt size limits._"
  end

  test "limits injected artifacts by aggregate byte budget" do
    root = temporary_workspace_root!("pb-byte-budget")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))

    File.write!(Path.join([root, "docs", "superpowers", "specs", "01.md"]), String.duplicate("a", 400_000))
    File.write!(Path.join([root, "docs", "superpowers", "specs", "02.md"]), String.duplicate("b", 400_000))
    File.write!(Path.join([root, "docs", "superpowers", "specs", "03.md"]), String.duplicate("c", 400_000))

    issue = %Issue{
      identifier: "MAC-5",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    assert prompt =~ "docs/superpowers/specs/01.md"
    assert prompt =~ "docs/superpowers/specs/02.md"
    refute prompt =~ "docs/superpowers/specs/03.md"
    refute prompt =~ String.duplicate("c", 100)
    assert prompt =~ "_Skipped 1 additional authoring artifact(s) due to prompt size limits._"
  end

  test "injects a long-running workflow section for Claude when a goal is set" do
    issue = %Issue{
      identifier: "MAC-6",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress",
      agent_goal: "  Ship the OAuth login flow and verify it.  "
    }

    prompt = PromptBuilder.build_prompt(issue, agent_kind: "claude")

    assert prompt =~ "Ticket MAC-6"
    assert prompt =~ "## Long-running workflow"
    assert prompt =~ "Ship the OAuth login flow and verify it."
  end

  test "omits the workflow section for Codex (native goal handles it)" do
    issue = %Issue{
      identifier: "MAC-7",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress",
      agent_goal: "Ship the OAuth login flow and verify it."
    }

    prompt = PromptBuilder.build_prompt(issue, agent_kind: "codex")

    refute prompt =~ "## Long-running workflow"
  end

  test "omits the workflow section for Claude without a goal" do
    issue = %Issue{
      identifier: "MAC-8",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress",
      agent_goal: nil
    }

    prompt = PromptBuilder.build_prompt(issue, agent_kind: "claude")

    refute prompt =~ "## Long-running workflow"
  end

  test "builds the prompt from the issue's project template" do
    seed_project_with_setup("alpha", "ALPHA {{ issue.identifier }}")

    issue = %Issue{identifier: "A-1", project_slug: "alpha", state: "Todo"}

    prompt = PromptBuilder.build_prompt(issue, [])

    assert prompt =~ "ALPHA A-1"
  end

  test "preview_context_section includes guidance when preview is disabled" do
    issue = %Issue{
      identifier: "#1",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    section = PromptBuilder.preview_context_section(issue)

    assert section =~ "## Issue preview (Symphony)"
    assert section =~ "manage_preview"
    assert section =~ "configured"
    refute section =~ "run-e2e.sh"
  end

  test "preview_context_section stays generic (no project-specific e2e path)" do
    issue = %Issue{
      identifier: "#38",
      project_slug: "distributionmachine",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    section = PromptBuilder.preview_context_section(issue)

    if section != "" do
      assert section =~ "## Issue preview (Symphony)"
      assert section =~ "manage_preview"
      refute section =~ "run-e2e.sh"
    end
  end

  test "validate_section renders project-specific commands from the evidence config" do
    config = %ProjectConfig{
      project_id: 1,
      project_slug: "dm",
      tracker_kind: "local",
      evidence: %{
        required: true,
        repos: %{
          "admin" => %{
            unit_command: "cd admin && bun run test",
            ui_paths: ["admin/src/**"],
            e2e: %{command: "cd admin && bash .symphony/run-e2e.sh"}
          },
          "distributionmachine" => %{
            unit_command: "python -m pytest tests/test_modules.py",
            impacts: ["admin"],
            contract_paths: ["api/**", "src/**"]
          }
        }
      }
    }

    section = PromptBuilder.validate_section(config)

    assert section =~ "## VALIDATE"
    assert section =~ "`evidence`"
    assert section =~ "cd admin && bun run test"
    assert section =~ "cd admin && bash .symphony/run-e2e.sh"
    assert section =~ "python -m pytest tests/test_modules.py"
    assert section =~ "admin/src/**"
    assert section =~ "impacts `admin`"
    assert section =~ "npx playwright test"
    assert section =~ "manage_preview"

    {admin_pos, _} = :binary.match(section, "`admin`:")
    {dm_pos, _} = :binary.match(section, "`distributionmachine`:")
    assert admin_pos < dm_pos
  end

  test "validate_section is empty when the project has no evidence config" do
    config = %ProjectConfig{
      project_id: 1,
      project_slug: "noevidence",
      tracker_kind: "local",
      evidence: %{}
    }

    assert PromptBuilder.validate_section(config) == ""
  end

  test "build_prompt injects the project's pre-filled VALIDATE evidence section" do
    seed_project_with_evidence("dm", "Ticket {{ issue.identifier }}", %{
      "evidence" => %{
        "required" => true,
        "repos" => %{
          "admin" => %{
            "unit_command" => "cd admin && bun run test",
            "ui_paths" => ["admin/src/**"],
            "e2e" => %{"command" => "cd admin && bash .symphony/run-e2e.sh"}
          },
          "distributionmachine" => %{
            "unit_command" => "python -m pytest tests/test_modules.py",
            "impacts" => ["admin"]
          }
        }
      }
    })

    issue = %Issue{
      identifier: "DM-38",
      project_slug: "dm",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue)

    assert prompt =~ "Ticket DM-38"
    assert prompt =~ "## VALIDATE"
    assert prompt =~ "cd admin && bash .symphony/run-e2e.sh"
    assert prompt =~ "python -m pytest tests/test_modules.py"
  end

  test "build_prompt omits the VALIDATE section when the project has no evidence config" do
    issue = %Issue{
      identifier: "MAC-9",
      project_slug: "mac",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    refute PromptBuilder.build_prompt(issue) =~ "## VALIDATE"
  end

  test "raises a tagged error when the issue has no project_slug (no global fallback)" do
    issue = %Issue{identifier: "G-1", project_slug: nil, state: "Todo"}

    assert_raise RuntimeError, ~r/prompt_unresolved/, fn ->
      PromptBuilder.build_prompt(issue, [])
    end
  end

  test "raises a tagged error when the issue's project has no prompt (no global fallback)" do
    {:ok, project} = Context.ensure_project(%{name: "noprompt", slug: "noprompt", tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: "",
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    issue = %Issue{identifier: "NP-1", project_slug: "noprompt", state: "Todo"}

    assert_raise RuntimeError, ~r/prompt_unresolved.*noprompt/, fn ->
      PromptBuilder.build_prompt(issue, [])
    end
  end

  test "group_members_section lists each member with identifier and title" do
    members = [
      %Issue{identifier: "MAC-2", title: "Add API", description: "desc", agent_goal: nil},
      %Issue{identifier: "MAC-3", title: "Add UI", description: nil, agent_goal: "ship it"}
    ]

    section = PromptBuilder.group_members_section(members)
    assert section =~ "Grouped tasks"
    assert section =~ "MAC-2: Add API"
    assert section =~ "MAC-3: Add UI"
    assert section =~ "Symphony-Issue:"
    assert PromptBuilder.group_members_section([]) == ""
  end

  defp seed_project_with_setup(slug, prompt) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: SymphonyElixir.Workflow.to_markdown(%{}, prompt || ""),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    project
  end

  defp seed_project_with_evidence(slug, prompt, front_matter) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: SymphonyElixir.Workflow.to_markdown(front_matter, prompt || ""),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    project
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp temporary_workspace_root!(name) do
    root = Path.join(System.tmp_dir!(), "#{name}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)
    root
  end
end
