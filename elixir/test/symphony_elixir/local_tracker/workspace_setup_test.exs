defmodule SymphonyElixir.LocalTracker.WorkspaceSetupTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{GitHubDiscovery, RepositoryScanner, WorkflowSuggester}

  setup do
    previous_token = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "test-token")

    on_exit(fn ->
      if previous_token, do: System.put_env("GITHUB_TOKEN", previous_token), else: System.delete_env("GITHUB_TOKEN")
    end)

    :ok
  end

  test "repository scanner reads known metadata files without executing commands" do
    root = Path.join(System.tmp_dir!(), "symphony-scanner-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)

    File.write!(Path.join(root, "pnpm-lock.yaml"), "")
    File.write!(Path.join(root, "AGENTS.md"), "Use project instructions.")

    File.write!(Path.join(root, "package.json"), """
    {"scripts":{"test":"vitest run","lint":"eslint ."}}
    """)

    assert {:ok, scan} = RepositoryScanner.scan(%{"local_path" => root, "workspace_path" => "frontend"})

    assert scan.local_path == root
    assert scan.workspace_path == "frontend"
    assert "node" in scan.stack
    assert scan.package_manager == "pnpm"
    assert scan.scripts == ["lint", "test"]
    assert scan.agent_instruction_files == ["AGENTS.md"]
    assert scan.validation_commands == ["pnpm run lint", "pnpm test"]
  end

  test "workflow suggester builds workflow setup for frontend and backend repositories" do
    repositories = [
      %{
        "github_full_name" => "clouapp/front",
        "clone_url" => "https://github.com/clouapp/front.git",
        "selected_branch" => "homolog",
        "workspace_path" => "frontend",
        "role" => "frontend"
      },
      %{
        "github_full_name" => "clouapp/api",
        "clone_url" => "https://github.com/clouapp/api.git",
        "selected_branch" => "main",
        "workspace_path" => "backend",
        "role" => "backend"
      }
    ]

    scans = [
      %{workspace_path: "frontend", stack: ["node"], validation_commands: ["pnpm test"]},
      %{workspace_path: "backend", stack: ["elixir"], validation_commands: ["mix test"]}
    ]

    assert {:ok, suggestion} = WorkflowSuggester.suggest(%{"repositories" => repositories, "scans" => scans})

    assert Enum.map(suggestion.workflow_statuses, & &1.name) == [
             "Backlog",
             "Todo",
             "In Progress",
             "Human Review",
             "Rework",
             "Merging",
             "Done",
             "Cancelled",
             "Duplicate"
           ]

    assert {:ok, parsed} = SymphonyElixir.Workflow.parse_string(suggestion.workflow_markdown)
    assert parsed.config["tracker"]["active_states"] == ["Todo", "In Progress", "Rework", "Merging"]
    assert suggestion.validation_commands == ["pnpm test", "mix test"]
    assert suggestion.after_create_hook =~ "git clone --branch homolog https://github.com/clouapp/front.git frontend"
    assert suggestion.after_create_hook =~ "git clone --branch main https://github.com/clouapp/api.git backend"
    assert parsed.prompt_template =~ "frontend: clouapp/front"
    assert parsed.prompt_template =~ "backend: clouapp/api"
  end

  test "github discovery lists repositories for an owner with pagination" do
    request_fun = fn payload, _headers ->
      refute payload["query"] =~ "organization(login: $owner)"
      assert payload["query"] =~ "repositoryOwner(login: $owner)"
      assert payload["variables"] == %{"owner" => "clouapp", "after" => nil}

      body = %{
        "data" => %{
          "repositoryOwner" => %{
            "repositories" => %{
              "nodes" => [
                %{
                  "name" => "front",
                  "nameWithOwner" => "clouapp/front",
                  "description" => "Frontend",
                  "url" => "https://github.com/clouapp/front",
                  "sshUrl" => "git@github.com:clouapp/front.git",
                  "owner" => %{"avatarUrl" => "https://github.com/clouapp.png"},
                  "defaultBranchRef" => %{"name" => "homolog"},
                  "isPrivate" => true
                }
              ],
              "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
            }
          }
        }
      }

      {:ok, %{status: 200, body: body}}
    end

    assert {:ok, [repository]} = GitHubDiscovery.list_repositories("clouapp", request_fun: request_fun)
    assert repository.full_name == "clouapp/front"
    assert repository.default_branch == "homolog"
    assert repository.clone_url == "https://github.com/clouapp/front.git"
    assert repository.avatar_url == "https://github.com/clouapp.png"
    assert repository.suggested_local_path =~ "/front"
  end

  test "github discovery lists accessible owners from viewer and organizations" do
    request_fun = fn payload, _headers ->
      assert payload["query"] =~ "viewer"

      body = %{
        "data" => %{
          "viewer" => %{
            "login" => "raphaelcangucu",
            "avatarUrl" => "https://github.com/raphaelcangucu.png",
            "organizations" => %{
              "nodes" => [
                %{
                  "login" => "clouapp",
                  "name" => "Clou App",
                  "avatarUrl" => "https://github.com/clouapp.png"
                }
              ],
              "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
            }
          }
        }
      }

      {:ok, %{status: 200, body: body}}
    end

    assert {:ok, owners} = GitHubDiscovery.list_owners(request_fun: request_fun)

    assert Enum.map(owners, & &1.login) == ["raphaelcangucu", "clouapp"]
    assert Enum.map(owners, & &1.kind) == ["user", "organization"]
    assert Enum.at(owners, 1).avatar_url == "https://github.com/clouapp.png"
  end
end
