alias SymphonyElixir.LocalTracker.Context

[host_label, project_slug, requested_workspace_path] =
  case System.argv() do
    [host_label, project_slug, workspace_path] ->
      [host_label, project_slug, Path.expand(workspace_path)]

    _ ->
      raise "usage: mix run dev/mobile_comparison_e2e_seed.exs HOST_LABEL PROJECT_SLUG WORKSPACE_PATH"
  end

repo_root = Path.expand("../..", __DIR__)
workspace_root = requested_workspace_path <> "-root"
workspace_path = Path.join(workspace_root, "site")
public_path = Path.join(workspace_path, "public")
File.mkdir_p!(public_path)

for name <- [
      "dev10x_icon.png",
      "dev10x_logo_black.png",
      "dev10x_logo_color.png",
      "dev10x_logo_white.png",
      "favicon.png",
      "favicon.svg"
    ] do
  File.cp!(
    Path.join([repo_root, "tracker", "public", name]),
    Path.join(public_path, name)
  )
end

File.write!(
  Path.join(workspace_path, "README.md"),
  """
  # Dev10x comparison source

  Build the requested Dev10x site in this repository. Canonical logos, icon and
  favicon are already available under `public/`; reuse them without redrawing
  the brand. The finished repository must include a real build, an E2E test and
  `.symphony/evidence/manifest.json` with durable screenshots, an MP4 video,
  report and Playwright trace.
  """
)

File.write!(Path.join(workspace_path, ".gitignore"), "node_modules/\ndist/\n")

unless File.dir?(Path.join(workspace_path, ".git")) do
  {_output, 0} =
    System.cmd("git", ["init", "-b", "main"],
      cd: workspace_path,
      stderr_to_stdout: true
    )

  {_output, 0} =
    System.cmd("git", ["config", "user.email", "e2e@dev10x.test"], cd: workspace_path)

  {_output, 0} =
    System.cmd("git", ["config", "user.name", "Dev10x E2E"], cd: workspace_path)

  {_output, 0} = System.cmd("git", ["add", "."], cd: workspace_path)

  {_output, 0} =
    System.cmd("git", ["commit", "-m", "Seed canonical Dev10x site source"],
      cd: workspace_path,
      stderr_to_stdout: true
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
    - Ready
    - In Progress
    - Human Review
    - Done
  active_states:
    - Ready
    - In Progress
  dispatch_states:
    - Ready
  wait_states:
    - Human Review
  terminal_states:
    - Done
workspace:
  root: #{Jason.encode!(workspace_root)}
dev_server:
  enabled: true
  max_concurrent: 6
agent:
  kind: codex
  max_concurrent_agents: 6
  max_turns: 12
  turn_timeout_ms: 2400000
  completion_transitions:
    Ready: Human Review
    In Progress: Human Review
codex:
  approval_policy: never
  thread_sandbox: danger-full-access
---
{{ issue.description }}
"""

{:ok, _project} =
  Context.create_workspace_project(%{
    name: "#{host_label} Dev10x Comparison",
    slug: project_slug,
    description: "Real local six-cell Dev10x mobile comparison",
    tracker: %{kind: "local", config: %{}},
    workflow_statuses: [
      %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
      %{name: "Ready", category: "active", position: 1, is_terminal: false},
      %{name: "In Progress", category: "active", position: 2, is_terminal: false},
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
        workspace_path: "site",
        role: "application",
        scan_summary: %{"stack" => ["html", "css", "javascript", "playwright"]}
      }
    ],
    setup: %{
      workflow_markdown: workflow_markdown,
      validation_commands: [],
      scan_summary: %{"purpose" => "dev10x-mobile-real-comparison"}
    }
  })

IO.puts(
  Jason.encode!(%{
    host: host_label,
    project_slug: project_slug,
    workspace_path: workspace_path,
    source_repo: bare_repo_path
  })
)
