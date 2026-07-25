alias SymphonyElixir.Assistant.{History, Thread}
alias SymphonyElixir.LocalTracker.Context
alias SymphonyElixir.Repo

[host_label, project_slug, workspace_path] =
  case System.argv() do
    [host_label, project_slug, workspace_path] ->
      [host_label, project_slug, Path.expand(workspace_path)]

    _ ->
      raise "usage: mix run dev/mobile_e2e_seed.exs -- HOST_LABEL PROJECT_SLUG WORKSPACE_PATH"
  end

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

{:ok, _project} =
  Context.ensure_project(%{
    name: "#{host_label} Project",
    slug: project_slug,
    description: "Deterministic direct-host E2E project"
  })

{:ok, primary} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: encrypted mobile control",
    description: "Pair, switch hosts, inspect sessions and operate this workspace without a central hub.",
    status: "In Progress",
    priority: 1,
    agent_goal: "Validate the complete Orca-style Symphony Mobile workflow",
    branch_name: "agent/mobile-multi-host-e2e"
  })

{:ok, blocker} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: verify host isolation",
    description: "The same local identifiers may exist on both hosts.",
    status: "Todo",
    priority: 2
  })

{:ok, subtask} =
  Context.create_issue(project_slug, %{
    title: "#{host_label}: record native evidence",
    description: "Capture the encrypted direct-host journey.",
    status: "Todo",
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

{:ok, thread} =
  %Thread{}
  |> Thread.changeset(%{
    scope: "project_session",
    project_slug: project_slug,
    title: "#{host_label} — Direct RPC session",
    workspace_path: workspace_path,
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
    thread_id: thread.id
  })
)
