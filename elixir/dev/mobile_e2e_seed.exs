alias SymphonyElixir.Assistant.{History, Thread}
alias SymphonyElixir.LocalTracker.Context
alias SymphonyElixir.Repo
alias SymphonyElixir.Workspace

[host_label, project_slug, requested_workspace_path] =
  case System.argv() do
    [host_label, project_slug, workspace_path] ->
      [host_label, project_slug, Path.expand(workspace_path)]

    _ ->
      raise "usage: mix run dev/mobile_e2e_seed.exs HOST_LABEL PROJECT_SLUG WORKSPACE_PATH"
  end

workspace_root = requested_workspace_path <> "-root"
workspace_path = Path.join(workspace_root, "app")

File.mkdir_p!(workspace_path)
File.write!(Path.join(workspace_path, "README.md"), "# #{host_label}\n\nDirect encrypted mobile RPC fixture.\n")
File.mkdir_p!(Path.join(workspace_path, "docs"))

File.write!(
  Path.join(workspace_path, "docs/mobile.md"),
  """
  # Symphony Mobile

  This workspace is controlled directly through #{host_label}.
  """
)

unless File.dir?(Path.join(workspace_path, ".git")) do
  {_output, 0} = System.cmd("git", ["init", "-b", "main"], cd: workspace_path, stderr_to_stdout: true)
  {_output, 0} = System.cmd("git", ["config", "user.email", "e2e@symphony.test"], cd: workspace_path)
  {_output, 0} = System.cmd("git", ["config", "user.name", "Symphony E2E"], cd: workspace_path)
  {_output, 0} = System.cmd("git", ["add", "."], cd: workspace_path)

  {_output, 0} =
    System.cmd("git", ["commit", "-m", "Seed direct-host mobile workspace"],
      cd: workspace_path,
      stderr_to_stdout: true
    )

  File.write!(
    Path.join(workspace_path, "README.md"),
    "\nUncommitted change visible in the mobile diff.\n",
    [:append]
  )
end

bare_repo_path = requested_workspace_path <> "-source.git"

unless File.dir?(bare_repo_path) do
  {_output, 0} =
    System.cmd("git", ["clone", "--bare", workspace_path, bare_repo_path], stderr_to_stdout: true)
end

workflow_markdown = """
---
tracker:
  field_states:
    - Backlog
    - In Progress
    - Ready
    - Human Review
    - Done
  active_states:
    - Ready
  dispatch_states:
    - Ready
  wait_states:
    - Human Review
  terminal_states:
    - Done
workspace:
  root: #{Jason.encode!(workspace_root)}
dev_server:
  enabled: false
agent:
  kind: codex
  max_concurrent_agents: 1
  max_turns: 6
  completion_transitions:
    Ready: Human Review
codex:
  approval_policy: never
  thread_sandbox: danger-full-access
---
{{ issue.description }}
"""

{:ok, _project} =
  Context.create_workspace_project(%{
    name: "#{host_label} Project",
    slug: project_slug,
    description: "Deterministic direct-host E2E project",
    tracker: %{kind: "local", config: %{}},
    workflow_statuses: [
      %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
      %{name: "In Progress", category: "active", position: 1, is_terminal: false},
      %{name: "Ready", category: "active", position: 2, is_terminal: false},
      %{name: "Human Review", category: "wait", position: 3, is_terminal: false},
      %{name: "Done", category: "terminal", position: 4, is_terminal: true}
    ],
    repositories: [
      %{
        github_full_name: "local/#{project_slug}",
        clone_url: bare_repo_path,
        default_branch: "main",
        selected_branch: "main",
        local_path: workspace_path,
        workspace_path: "app",
        role: "application",
        scan_summary: %{"stack" => ["markdown"]}
      }
    ],
    setup: %{
      workflow_markdown: workflow_markdown,
      validation_commands: [],
      scan_summary: %{"purpose" => "mobile-real-host-e2e"}
    }
  })

{:ok, primary} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: encrypted mobile control",
    description: "Pair, switch hosts, inspect sessions and operate this workspace without a central hub.",
    status: "In Progress",
    priority: 1,
    agent_goal: "Validate the complete Dev10x Mobile workflow",
    branch_name: "agent/mobile-multi-host-e2e"
  })

{:ok, blocker} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: verify host isolation",
    description: "The same local identifiers may exist on both hosts.",
    status: "Backlog",
    priority: 2
  })

{:ok, subtask} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: record native evidence",
    description: "Capture the encrypted direct-host journey.",
    status: "Backlog",
    priority: 2
  })

{:ok, _relation} = Context.add_blocker(project_slug, primary.identifier, blocker.identifier)
{:ok, _subtask} = Context.set_issue_parent(project_slug, subtask.identifier, primary.identifier)

{:ok, _comment} =
  Context.add_comment(
    project_slug,
    primary.identifier,
    "This task is served by #{host_label} over its own encrypted RPC connection.",
    %{author: "Symphony E2E"}
  )

{:ok, orchestrator_issue} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: live orchestrator steer",
    description: """
    Validate a real Dev10x Mobile orchestrator stream. Start by running
    `sleep 120`, remain available for an operator steer, then follow the
    operator's updated direction and report it clearly.
    """,
    status: "Backlog",
    priority: 1,
    agent: "codex"
  })

{:ok, session_workspace_path} =
  Workspace.create_for_issue(%{
    id: primary.id,
    identifier: primary.identifier,
    project_slug: project_slug
  })

File.write!(
  Path.join([session_workspace_path, "app", "README.md"]),
  "\nUncommitted change visible in the mobile diff.\n",
  [:append]
)

{:ok, thread} =
  %Thread{}
  |> Thread.changeset(%{
    scope: "issue_session",
    project_slug: project_slug,
    issue_identifier: primary.identifier,
    title: "#{host_label} — Direct RPC session",
    workspace_path: session_workspace_path,
    status: "active",
    agent_kind: "codex",
    metadata: %{"execution_mode" => "build"}
  })
  |> Repo.insert()

{:ok, _message} =
  History.append_message(thread, %{
    role: "assistant",
    content: "#{host_label} is online. Projects, tasks, sessions and tools are isolated on this machine."
  })

IO.puts(
  Jason.encode!(%{
    host: host_label,
    project_slug: project_slug,
    issue_identifier: primary.identifier,
    orchestrator_issue_identifier: orchestrator_issue.identifier,
    thread_id: thread.id
  })
)
