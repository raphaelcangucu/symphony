defmodule SymphonyElixir.Assistant.ToolExecutor do
  @moduledoc """
  Server-side tool boundary for the tracker project assistant.
  """

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.AgentPreference

  alias SymphonyElixir.Assistant.{
    BlockerTools,
    DiscoveryTools,
    DevEnvTools,
    DispatchTools,
    EvidenceTools,
    GitHubTools,
    GoalTools,
    HandoffTools,
    OrchestratorTools,
    PreviewTools,
    ProjectBoardTools,
    PullRequestLookup,
    PullRequestTools,
    ReadTools,
    RunningAgentsTools,
    SetupTools,
    SteerTools,
    SyncTools,
    ToolText
  }

  alias SymphonyElixir.Config
  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.{IssueAdapter, IssueDTO}
  alias SymphonyElixir.Tracker.Workpad
  alias SymphonyElixir.Workpad.ExecutionBundle
  alias SymphonyElixir.Workpad.ExecutionBundle.{Classifier, Store, Validator}
  alias SymphonyElixirWeb.TrackerPresenter

  @tracker_tools ~w(
    list_issues
    create_issue
    create_draft_issue
    update_issue
    move_issue
    add_comment
    list_comments
    update_comment
    list_pull_requests
    manage_preview
    update_project_workflow
    update_project_repositories
    get_agent_executions
    dispatch_coding_agent
    dispatch_codex
    check_handoff_gate
    get_evidence_status
    manage_dev_env
    scan_project_setup
    suggest_project_setup
    link_pull_request
    get_issue_orchestrator_state
    explain_dispatch_eligibility
    manage_blockers
    sync_issue
    list_running_agents
    steer_agent
    manage_codex_goal
    classify_execution_unit
    create_subtask
    set_issue_parent
    get_execution_bundle
    preview_execution_plan
    define_shared_contract
    update_shared_contract
  )
  @read_tools ReadTools.tools()
  @github_tools GitHubTools.tools()
  @discovery_tools DiscoveryTools.tools()
  @dynamic_tools Enum.map(DynamicTool.tool_specs(), & &1["name"])
  @supported_tools @tracker_tools ++ @read_tools ++ @github_tools
  # Routine assistant chat replies should not be mirrored as issue comments; use
  # `add_comment` only when the user asks to record a comment on the issue.
  @issue_bound_mutable_tools ~w(update_issue move_issue dispatch_coding_agent dispatch_codex)
  @issue_bound_supported_tools ~w(list_issues get_issue read_workspace_file update_issue move_issue get_agent_executions dispatch_coding_agent dispatch_codex manage_codex_goal)
  @in_progress_state "In Progress"

  @type result :: %{
          required(:tool) => String.t(),
          required(:message) => String.t(),
          required(:data) => map()
        }

  @spec supported_tools() :: [String.t()]
  def supported_tools, do: @supported_tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    build_tool_specs() |> ToolText.localize_specs()
  end

  defp build_tool_specs do
    [
      tool_spec("list_issues", "List tracker issues in the current project (prefer get_issue when you know the identifier).", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => ReadTools.list_issues_schema_properties()
      }),
      tool_spec("create_issue", "Create a tracker issue in the current project.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["title"],
        "properties" => %{
          "title" => string_schema("Issue title."),
          "description" => string_schema("Optional issue description."),
          "status" => string_schema("Optional workflow status. Omit to create in Backlog (intake). Do not use orchestrator queue statuses (e.g. Todo) on create — move_issue after intake when ready."),
          "priority" => %{"type" => ["integer", "null"], "description" => "Optional numeric priority."},
          "assignee_ids" => string_list_schema("Optional assignee logins or remote ids. Call get_issue_form_options first.")
        }
      }),
      tool_spec("create_draft_issue", "Create a draft tracker issue (non-actionable status) to anchor the authoring chat.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["title"],
        "properties" => %{
          "title" => string_schema("Issue title."),
          "description" => string_schema("Optional short description.")
        }
      }),
      tool_spec("update_issue", "Update mutable fields on an existing tracker issue.", %{
        "type" => "object",
        "additionalProperties" => true,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier, for example MAC-1."),
          "title" => string_schema("Optional new title."),
          "description" => string_schema("Optional new description."),
          "status" => string_schema("Optional workflow status."),
          "assignee_ids" => string_list_schema("Optional assignee logins or remote ids. Call get_issue_form_options first.")
        }
      }),
      tool_spec("move_issue", "Move an issue to a workflow status.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "status"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier, for example MAC-1."),
          "status" => string_schema("Target workflow status.")
        }
      }),
      tool_spec(
        "add_comment",
        "Add a comment on a tracker issue (use when the user wants it recorded on the issue, not for normal chat replies).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier", "body"],
          "properties" => %{
            "identifier" => string_schema("Issue identifier, for example MAC-1."),
            "body" => string_schema("Comment body markdown/text.")
          }
        }
      ),
      tool_spec(
        "list_comments",
        "List comments on a tracker issue (use to find workpad comment ids before update_comment).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier"],
          "properties" => %{
            "identifier" => string_schema("Issue identifier, for example MAC-1.")
          }
        }
      ),
      tool_spec(
        "update_comment",
        "Edit an existing issue comment in place (for workpad updates).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier", "comment_id", "body"],
          "properties" => %{
            "identifier" => string_schema("Issue identifier, for example MAC-1."),
            "comment_id" => %{
              "type" => ["string", "integer"],
              "description" => "Comment id from list_comments."
            },
            "body" => string_schema("Replacement comment body markdown/text.")
          }
        }
      ),
      tool_spec(
        "list_pull_requests",
        "List pull requests linked to an issue (GitHub discovery + persisted links).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier"],
          "properties" => %{
            "identifier" => string_schema("Issue identifier, for example MAC-1.")
          }
        }
      ),
      tool_spec(
        "update_project_workflow",
        "Update workflow markdown (YAML front matter + body). Orchestrator behavior requires tracker.* lists in front matter (dispatch_states, active_states, terminal_states, wait_states, field_states) — editing body prose alone does not change auto-dispatch. Preserve or update YAML when changing queue/work statuses.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["workflow_markdown"],
          "properties" => %{
            "workflow_markdown" => %{
              "type" => "string",
              "description" => "Full WORKFLOW markdown stored on the project."
            }
          }
        }
      ),
      tool_spec(
        "update_project_repositories",
        "Replace the repositories linked to this project in Symphony (same as Project Settings). Does not delete workspace files; only updates persisted metadata.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["repositories"],
          "properties" => %{
            "repositories" => repository_list_schema()
          }
        }
      ),
      tool_spec("get_agent_executions", "List active or retrying coding-agent executions for this project.", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }),
      tool_spec("dispatch_coding_agent", "Request coding-agent work (Codex or Claude) through the existing issue workflow.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "instructions"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier to dispatch, for example MAC-1."),
          "instructions" => string_schema("Concrete coding instructions for the agent."),
          "agent" => string_schema("Optional agent override: codex, claude, or cursor. Omit to follow task > project > user preference."),
          "goal" => string_schema("Optional long-running objective to persist for the orchestrator (Codex goal or Claude/Cursor workflow).")
        }
      }),
      tool_spec("dispatch_codex", "Alias for dispatch_coding_agent (resolves agent via task > project > user preference).", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "instructions"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier to dispatch, for example MAC-1."),
          "instructions" => string_schema("Concrete coding instructions for Codex."),
          "goal" => string_schema("Optional long-running Codex goal to persist for the orchestrator.")
        }
      }),
      tool_spec(
        "classify_execution_unit",
        "Deterministically classify a planned subtask as workpad_task (inline) or child_run (own run/worktree/PR). Preview only; no writes.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "repo" => string_schema("Target repo full name (owner/name) for the unit."),
            "parent_repo" => string_schema("The parent task's repo full name (owner/name)."),
            "deliverable" => string_schema("Optional deliverable hint, e.g. 'pr' for an independent shippable unit."),
            "produces" => string_list_schema("Optional shared-contract ids this unit produces."),
            "consumes" => string_list_schema("Optional shared-contract ids this unit consumes."),
            "depends_on" => string_list_schema("Optional unit ids this unit depends on.")
          }
        }
      ),
      tool_spec(
        "create_subtask",
        "Create a child issue under a parent and attach it to the parent's execution bundle. Omit unit_type to auto-classify (workpad_task inline vs child_run with its own PR/worktree). Use for breaking a task into subtasks.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["parent_identifier", "title"],
          "properties" => %{
            "parent_identifier" => string_schema("Parent issue identifier, e.g. MAC-42."),
            "title" => string_schema("Subtask title."),
            "description" => string_schema("Optional subtask description."),
            "repo" => string_schema("Target repository full name; defaults to the parent's primary repo."),
            "unit_type" => string_schema("Optional: 'workpad_task' or 'child_run'. Omit to auto-classify."),
            "produces" => string_list_schema("Optional shared-contract ids this subtask produces."),
            "consumes" => string_list_schema("Optional shared-contract ids this subtask consumes."),
            "depends_on" => string_list_schema("Optional unit ids this subtask depends on."),
            "deliverable" => string_schema("Optional: 'pr' for an independently shippable unit.")
          }
        }
      ),
      tool_spec(
        "set_issue_parent",
        "Change or clear a subtask's parent. Omit parent_identifier (or pass null) to detach to standalone. Rejects cycles; moves the unit between parent execution bundles.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier"],
          "properties" => %{
            "identifier" => string_schema("Subtask issue identifier, e.g. MAC-101."),
            "parent_identifier" => %{
              "type" => ["string", "null"],
              "description" => "New parent identifier, or null to detach."
            }
          }
        }
      ),
      tool_spec(
        "get_execution_bundle",
        "Read the parent's execution bundle (units, shared contracts, dependencies) from its workpad. Read-only.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["parent_identifier"],
          "properties" => %{"parent_identifier" => string_schema("Parent issue identifier, e.g. MAC-42.")}
        }
      ),
      tool_spec(
        "preview_execution_plan",
        "Validate the parent's execution bundle (dependency cycles, contracts consumed but never produced, cross-repo inline units). Returns ok + warnings. Read-only.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["parent_identifier"],
          "properties" => %{"parent_identifier" => string_schema("Parent issue identifier, e.g. MAC-42.")}
        }
      ),
      tool_spec(
        "define_shared_contract",
        "Define a shared contract (e.g. an API schema) in the parent bundle to coordinate child_run units across repos. Owner is the producing unit; consumers depend on it.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["parent_identifier", "id", "owner_unit", "kind"],
          "properties" => %{
            "parent_identifier" => string_schema("Parent issue identifier, e.g. MAC-42."),
            "id" => string_schema("Contract id (slug), e.g. lottery-wheel-api."),
            "owner_unit" => string_schema("Unit id that produces the contract."),
            "kind" => string_schema("Contract kind, e.g. graphql_mutation, rest_endpoint, event_schema."),
            "consumers" => string_list_schema("Unit ids that consume the contract."),
            "body" => string_schema("Optional contract body to append to the parent workpad."),
            "artifact_path" => string_schema("Optional path to the contract artifact in the repo.")
          }
        }
      ),
      tool_spec(
        "update_shared_contract",
        "Update a shared contract's body or status. Changing the body of an already-ready contract flips it to 'changing' so consumers re-sync.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["parent_identifier", "id"],
          "properties" => %{
            "parent_identifier" => string_schema("Parent issue identifier, e.g. MAC-42."),
            "id" => string_schema("Contract id to update."),
            "body" => string_schema("Optional new contract body."),
            "status" => string_schema("Optional status: draft, ready, or changing.")
          }
        }
      )
    ] ++
      [HandoffTools.assistant_tool_spec(), EvidenceTools.assistant_tool_spec(), PreviewTools.assistant_tool_spec()] ++
      SetupTools.tool_specs() ++
      [DevEnvTools.assistant_tool_spec()] ++
      [
        PullRequestTools.assistant_tool_spec(),
        OrchestratorTools.assistant_tool_spec(),
        DispatchTools.assistant_tool_spec(),
        BlockerTools.assistant_tool_spec(),
        SyncTools.assistant_tool_spec(),
        RunningAgentsTools.assistant_tool_spec(),
        SteerTools.assistant_tool_spec(),
        GoalTools.assistant_tool_spec()
      ] ++
      ReadTools.tool_specs() ++ GitHubTools.tool_specs()
  end

  @spec combined_tool_specs() :: [map()]
  def combined_tool_specs, do: tool_specs() ++ DynamicTool.tool_specs()

  @spec combined_codex_tool_executor(String.t(), keyword()) :: (String.t() | nil, term() -> map())
  def combined_codex_tool_executor(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    tracker = codex_tool_executor(project_slug, opts)

    fn tool, arguments ->
      name = to_string(tool)

      if name in @dynamic_tools do
        DynamicTool.execute(name, arguments, opts)
      else
        tracker.(tool, arguments)
      end
    end
  end

  @spec issue_bound_combined_codex_tool_executor(String.t(), String.t(), keyword()) ::
          (String.t() | nil, term() -> map())
  def issue_bound_combined_codex_tool_executor(project_slug, issue_identifier, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_list(opts) do
    tracker = issue_bound_codex_tool_executor(project_slug, issue_identifier, opts)

    fn tool, arguments ->
      name = to_string(tool)

      if name in @dynamic_tools do
        DynamicTool.execute(name, arguments, opts)
      else
        tracker.(tool, arguments)
      end
    end
  end

  # Project-agnostic tools available in freeform chat (no existing project context):
  # GitHub project provisioning, raw GraphQL, and workflow/template lookups.
  @freeform_project_agnostic_read_tools ~w(get_template list_templates)

  @spec freeform_tool_specs() :: [map()]
  def freeform_tool_specs do
    read_specs =
      ReadTools.tool_specs()
      |> Enum.filter(&(&1["name"] in @freeform_project_agnostic_read_tools))

    (DiscoveryTools.tool_specs() ++
       ProjectBoardTools.tool_specs() ++
       GitHubTools.tool_specs() ++
       read_specs ++
       DynamicTool.tool_specs())
    |> ToolText.localize_specs()
  end

  @spec freeform_codex_tool_executor(keyword()) :: (String.t() | nil, term() -> map())
  def freeform_codex_tool_executor(opts \\ []) when is_list(opts) do
    fn tool, arguments ->
      name = to_string(tool)
      arguments = if is_map(arguments), do: stringify_keys(arguments), else: %{}

      cond do
        name in @dynamic_tools ->
          DynamicTool.execute(name, arguments, opts)

        name in @discovery_tools ->
          wrap_for_codex(DiscoveryTools.execute(name, arguments, opts))

        name in ProjectBoardTools.tools() ->
          wrap_for_codex(ProjectBoardTools.execute(name, arguments, opts))

        name in @github_tools ->
          wrap_for_codex(GitHubTools.execute(name, arguments, opts))

        name in @freeform_project_agnostic_read_tools ->
          wrap_for_codex(ReadTools.execute(nil, name, arguments, opts))

        true ->
          codex_failure_response({:unsupported_tool, name})
      end
    end
  end

  defp wrap_for_codex({:ok, result}), do: codex_success_response(result)
  defp wrap_for_codex({:error, reason}), do: codex_failure_response(reason)

  @spec issue_bound_tool_specs(String.t()) :: [map()]
  def issue_bound_tool_specs(issue_identifier) when is_binary(issue_identifier) do
    identifier = normalize_issue_identifier!(issue_identifier)

    build_tool_specs()
    |> Enum.filter(&(Map.get(&1, "name") in @issue_bound_supported_tools))
    |> Enum.reject(&(&1["name"] == "manage_codex_goal"))
    |> Kernel.++([GoalTools.issue_bound_tool_spec()])
    |> ToolText.localize_specs()
    |> Enum.map(&bind_tool_spec_identifier(&1, identifier))
  end

  @spec codex_tool_executor(String.t(), keyword()) :: (String.t() | nil, term() -> map())
  def codex_tool_executor(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    fn tool, arguments -> execute_for_codex(project_slug, tool, arguments, opts) end
  end

  @spec issue_bound_codex_tool_executor(String.t(), String.t(), keyword()) :: (String.t() | nil, term() -> map())
  def issue_bound_codex_tool_executor(project_slug, issue_identifier, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_list(opts) do
    identifier = normalize_issue_identifier!(issue_identifier)

    fn tool, arguments ->
      tool_name = to_string(tool)
      arguments = if is_map(arguments), do: stringify_keys(arguments), else: %{}

      executor_opts = Keyword.put(opts, :bound_issue_identifier, identifier)

      case bind_issue_tool_arguments(tool_name, arguments, identifier) do
        {:ok, bound_arguments} -> execute_for_codex(project_slug, tool_name, bound_arguments, executor_opts)
        {:error, reason} -> codex_failure_response(reason)
      end
    end
  end

  @spec execute_for_codex(String.t(), String.t() | nil, term(), keyword()) :: map()
  def execute_for_codex(project_slug, tool, arguments, opts \\ []) do
    arguments = if is_map(arguments), do: stringify_keys(arguments), else: %{}

    case execute(project_slug, to_string(tool), arguments, opts) do
      {:ok, result} -> codex_success_response(result)
      {:error, reason} -> codex_failure_response(reason)
    end
  end

  @spec execute(String.t(), String.t(), map()) :: {:ok, result()} | {:error, term()}
  def execute(project_slug, tool, arguments), do: execute(project_slug, tool, arguments, [])

  @spec execute_create_tracker_project(map(), keyword()) :: {:ok, result()} | {:error, term()}
  def execute_create_tracker_project(arguments, _opts \\ []) when is_map(arguments) do
    with {:ok, name} <- normalize_required_string(Map.get(arguments, "name"), :name),
         {:ok, slug} <- normalize_required_string(Map.get(arguments, "slug"), :slug) do
      attrs = %{
        "name" => name,
        "slug" => slug,
        "description" => normalize_optional_string(Map.get(arguments, "description")),
        "tracker" => %{"kind" => "local"}
      }

      case Context.create_workspace_project(attrs) do
        {:ok, project} ->
          statuses = Context.list_statuses(project.slug)

          {:ok,
           %{
             tool: "create_tracker_project",
             message: "Created local tracker project #{project.slug}.",
             data: TrackerPresenter.project(project, statuses)
           }}

        {:error, %Ecto.Changeset{} = changeset} ->
          {:error, {:invalid_changeset, changeset}}
      end
    end
  end

  @spec execute(String.t(), String.t(), map(), keyword()) :: {:ok, result()} | {:error, term()}
  def execute(project_slug, tool, arguments, opts)
      when is_binary(project_slug) and is_binary(tool) and is_map(arguments) do
    with {:ok, project_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, project} <- Context.get_project(project_slug) do
      opts = maybe_put_bound_issue(opts)
      do_execute(project, tool, arguments, opts)
    end
  end

  def execute(_project_slug, _tool, _arguments, _opts), do: {:error, :invalid_arguments}

  defp do_execute(project, "list_issues", arguments, _opts) do
    filters =
      []
      |> maybe_put_filter(:search, Map.get(arguments, "search"))
      |> maybe_put_filter(:assignee, Map.get(arguments, "assignee"))
      |> maybe_put_filter(:creator, Map.get(arguments, "creator"))

    with {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [filters]) do
      presented =
        issues
        |> Enum.map(&TrackerPresenter.issue/1)
        |> ReadTools.apply_list_limits(arguments)

      {:ok,
       %{
         tool: "list_issues",
         message: "Found #{length(presented)} issue(s).",
         data: %{issues: presented}
       }}
    end
  end

  defp do_execute(project, tool, arguments, opts) when tool in @read_tools do
    ReadTools.execute(project, tool, arguments, opts)
  end

  defp do_execute(_project, tool, arguments, opts) when tool in @github_tools do
    GitHubTools.execute(tool, arguments, opts)
  end

  defp do_execute(project, "create_issue", arguments, _opts) do
    with {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
         {:ok, status} <- resolve_create_status(project, Map.get(arguments, "status")),
         attrs <- build_create_attrs(arguments, title, status),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "create_issue",
         message: "Created issue #{presented.identifier}: #{presented.title}",
         data: presented
       }}
    end
  end

  defp do_execute(project, "create_draft_issue", arguments, _opts) do
    with {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
         {:ok, draft_status} <- resolve_draft_status(project),
         attrs <- build_draft_attrs(arguments, title, draft_status),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "create_draft_issue",
         message: "Created draft #{presented.identifier}: #{presented.title}",
         data: presented
       }}
    end
  end

  defp do_execute(project, "update_issue", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         attrs <- arguments |> Map.drop(["identifier"]) |> normalize_assignee_arguments(),
         {:ok, issue} <- IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "update_issue",
         message: "Updated issue #{presented.identifier}.",
         data: presented
       }}
    end
  end

  defp do_execute(project, "move_issue", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, status} <- normalize_required_string(Map.get(arguments, "status"), :status),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => status}]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "move_issue",
         message: "Moved issue #{presented.identifier} to #{status}.",
         data: presented
       }}
    end
  end

  defp do_execute(project, "add_comment", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, body} <- normalize_required_string(Map.get(arguments, "body"), :body),
         {:ok, comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, body, comment_attrs(arguments)]) do
      presented = TrackerPresenter.comment(comment)

      {:ok,
       %{
         tool: "add_comment",
         message: "Added comment to #{identifier}.",
         data: %{comment: presented}
       }}
    end
  end

  defp do_execute(project, "check_handoff_gate", arguments, opts) do
    slug = project_slug(project)

    case HandoffTools.execute(slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "get_evidence_status", arguments, opts) do
    slug = project_slug(project)

    case EvidenceTools.execute(slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "manage_dev_env", arguments, opts) do
    slug = project_slug(project)

    case DevEnvTools.execute(slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "scan_project_setup", arguments, opts) do
    slug = project_slug(project)

    case SetupTools.execute("scan_project_setup", slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "suggest_project_setup", arguments, opts) do
    slug = project_slug(project)

    case SetupTools.execute("suggest_project_setup", slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "list_comments", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [identifier]) do
      presented = Enum.map(comments, &TrackerPresenter.comment/1)

      {:ok,
       %{
         tool: "list_comments",
         message: "Found #{length(presented)} comment(s) for #{identifier}.",
         data: %{comments: presented}
       }}
    end
  end

  defp do_execute(project, "update_comment", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, comment_id} <- normalize_comment_id(Map.get(arguments, "comment_id")),
         {:ok, body} <- normalize_required_string(Map.get(arguments, "body"), :body),
         {:ok, comment} <- IssueAdapter.dispatch(project, :update_comment, [identifier, comment_id, body]) do
      {:ok,
       %{
         tool: "update_comment",
         message: "Updated comment on #{identifier}.",
         data: %{comment: TrackerPresenter.comment(comment)}
       }}
    end
  end

  defp do_execute(project, "list_pull_requests", arguments, opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, payload} <- PullRequestLookup.list_for_issue(project, identifier, opts) do
      prs = Map.get(payload, :pull_requests, [])

      {:ok,
       %{
         tool: "list_pull_requests",
         message: "Found #{length(prs)} pull request(s) for #{identifier}.",
         data: payload
       }}
    end
  end

  defp do_execute(project, "manage_preview", arguments, opts) do
    slug = project_slug(project)

    case PreviewTools.execute(slug, arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "link_pull_request", arguments, opts) do
    case PullRequestTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "get_issue_orchestrator_state", arguments, opts) do
    case OrchestratorTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "explain_dispatch_eligibility", arguments, opts) do
    case DispatchTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "manage_blockers", arguments, opts) do
    case BlockerTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "sync_issue", arguments, opts) do
    case SyncTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_execute(project, "list_running_agents", arguments, opts) do
    RunningAgentsTools.execute(project_slug(project), arguments, opts)
  end

  defp do_execute(project, "steer_agent", arguments, opts) do
    SteerTools.execute(project_slug(project), arguments, opts)
  end

  defp do_execute(project, "manage_codex_goal", arguments, opts) do
    case GoalTools.execute(project_slug(project), arguments, opts) do
      {:ok, result} -> {:ok, result}
      {:error, reason} -> {:error, goal_tool_error(reason)}
    end
  end

  defp do_execute(project, "update_project_workflow", arguments, _opts) do
    slug = project_slug(project)

    with {:ok, markdown} <- normalize_required_string(Map.get(arguments, "workflow_markdown"), :workflow_markdown),
         :ok <- validate_workflow_markdown(markdown),
         {:ok, _setup} <- Context.upsert_project_setup(slug, %{"workflow_markdown" => markdown}) do
      statuses = Context.list_statuses(slug)
      repositories = Context.list_repositories(slug)
      setup = Context.get_project_setup(slug)

      {:ok,
       %{
         tool: "update_project_workflow",
         message: "Updated workflow for #{slug}.",
         data: TrackerPresenter.project(project, statuses, repositories, setup)
       }}
    end
  end

  defp do_execute(project, "update_project_repositories", arguments, _opts) do
    slug = project_slug(project)

    with {:ok, repositories} <- normalize_repository_list(Map.get(arguments, "repositories")),
         {:ok, _} <- replace_project_repositories(slug, repositories) do
      statuses = Context.list_statuses(slug)
      repositories = Context.list_repositories(slug)
      setup = Context.get_project_setup(slug)

      {:ok,
       %{
         tool: "update_project_repositories",
         message: "Updated #{length(repositories)} linked repositor#{if length(repositories) == 1, do: "y", else: "ies"} for #{slug}.",
         data: TrackerPresenter.project(project, statuses, repositories, setup)
       }}
    end
  end

  defp do_execute(project, "get_agent_executions", _arguments, opts) do
    with {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [[]]) do
      issue_ids = issues |> Enum.map(&to_string(&1.id)) |> MapSet.new()
      issue_identifiers = issues |> Enum.map(& &1.identifier) |> MapSet.new()
      list_agent_executions = Keyword.get(opts, :agent_execution_list, &AgentExecution.list/0)

      executions =
        list_agent_executions.()
        |> Enum.filter(&project_execution?(&1, issue_ids, issue_identifiers))
        |> Enum.map(&TrackerPresenter.agent_execution/1)

      {:ok,
       %{
         tool: "get_agent_executions",
         message: "Found #{length(executions)} agent execution(s).",
         data: %{agent_executions: executions}
       }}
    end
  end

  defp do_execute(project, "dispatch_codex", arguments, opts),
    do: do_execute(project, "dispatch_coding_agent", arguments, opts)

  defp do_execute(project, "dispatch_coding_agent", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, instructions} <- normalize_required_string(Map.get(arguments, "instructions"), :instructions),
         {:ok, current} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         :ok <- ensure_in_dispatch_queue(project, current),
         :ok <- ensure_status_available(project, @in_progress_state),
         {:ok, agent} <- resolve_dispatch_agent(project, identifier, Map.get(arguments, "agent")),
         {:ok, _comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, codex_comment(instructions), %{"author" => "assistant"}]),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, dispatch_agent_attrs(agent, arguments)]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "dispatch_coding_agent",
         message: "Requested #{agent_display(agent)} work on #{presented.identifier}",
         data: presented
       }}
    end
  end

  defp do_execute(_project, "classify_execution_unit", arguments, _opts) do
    unit = %{
      repo: normalize_optional_string(Map.get(arguments, "repo")),
      deliverable: normalize_optional_string(Map.get(arguments, "deliverable")),
      produces: normalize_string_list(Map.get(arguments, "produces")),
      consumes: normalize_string_list(Map.get(arguments, "consumes")),
      depends_on: normalize_string_list(Map.get(arguments, "depends_on"))
    }

    parent_repo = normalize_optional_string(Map.get(arguments, "parent_repo"))

    {classification, rule} =
      case SymphonyElixir.Workpad.ExecutionBundle.Classifier.classify(unit, parent_repo: parent_repo) do
        {:ok, type, rule} -> {to_string(type), to_string(rule)}
        {:ambiguous, reason} -> {"ambiguous", to_string(reason)}
      end

    {:ok,
     %{
       tool: "classify_execution_unit",
       message: "Classified as #{classification} (#{rule}).",
       data: %{classification: classification, rule: rule}
     }}
  end

  defp do_execute(project, "create_subtask", arguments, _opts) do
    with {:ok, parent_id} <- normalize_required_string(Map.get(arguments, "parent_identifier"), :parent_identifier),
         {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
         {:ok, parent} <- IssueAdapter.dispatch(project, :get_issue, [parent_id]),
         repo <- normalize_optional_string(Map.get(arguments, "repo")) || parent.repository_full_name,
         {:ok, type} <- resolve_unit_type(arguments, repo, parent.repository_full_name),
         attrs <- build_subtask_attrs(arguments, title),
         {:ok, child} <- IssueAdapter.dispatch(project, :create_issue, [attrs]),
         :ok <- link_subtask_parent(project, parent, child),
         {:ok, _comment} <- upsert_bundle_unit(project, parent, child, repo, type, arguments) do
      {:ok,
       %{
         tool: "create_subtask",
         message: "Created #{type} subtask #{child.identifier} under #{parent.identifier}.",
         data: %{
           parent: parent.identifier,
           subtask: child.identifier,
           unit_type: to_string(type),
           repo: repo
         }
       }}
    end
  end

  defp do_execute(project, "set_issue_parent", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         new_parent <- normalize_optional_string(Map.get(arguments, "parent_identifier")),
         :ok <- reject_reparent_cycle(project, identifier, new_parent) do
      reparent_subtask(project, identifier, new_parent)
    end
  end

  defp do_execute(project, "get_execution_bundle", arguments, _opts) do
    with {:ok, parent_id} <- normalize_required_string(Map.get(arguments, "parent_identifier"), :parent_identifier),
         {:ok, _comment, body} <- read_parent_workpad(project, parent_id) do
      bundle = parsed_bundle(body)

      {:ok,
       %{
         tool: "get_execution_bundle",
         message: "Bundle for #{parent_id}: #{length(bundle.units)} unit(s), #{length(bundle.shared_contracts)} contract(s).",
         data: bundle_data(bundle)
       }}
    end
  end

  defp do_execute(project, "preview_execution_plan", arguments, _opts) do
    with {:ok, parent_id} <- normalize_required_string(Map.get(arguments, "parent_identifier"), :parent_identifier),
         {:ok, parent} <- IssueAdapter.dispatch(project, :get_issue, [parent_id]),
         {:ok, _comment, body} <- read_parent_workpad(project, parent_id) do
      bundle = parsed_bundle(body)

      {ok?, warnings} =
        case Validator.validate(bundle, parent_repo: parent.repository_full_name) do
          :ok -> {true, []}
          {:error, warns} -> {false, warns}
        end

      {:ok,
       %{
         tool: "preview_execution_plan",
         message: if(ok?, do: "Execution plan is valid.", else: "Execution plan has #{length(warnings)} warning(s)."),
         data: %{ok: ok?, warnings: warnings}
       }}
    end
  end

  defp do_execute(project, "define_shared_contract", arguments, _opts) do
    with {:ok, parent_id} <- normalize_required_string(Map.get(arguments, "parent_identifier"), :parent_identifier),
         {:ok, id} <- normalize_required_string(Map.get(arguments, "id"), :id),
         {:ok, owner_unit} <- normalize_required_string(Map.get(arguments, "owner_unit"), :owner_unit),
         {:ok, kind} <- normalize_required_string(Map.get(arguments, "kind"), :kind),
         {:ok, comment, body} <- read_parent_workpad(project, parent_id) do
      contract = %{
        id: id,
        kind: kind,
        owner_unit: owner_unit,
        consumers: normalize_string_list(Map.get(arguments, "consumers")),
        artifact: normalize_optional_string(Map.get(arguments, "artifact_path")),
        status: :draft
      }

      with {:ok, updated} <- Store.upsert_contract(body, contract),
           updated <- append_contract_body(updated, id, normalize_optional_string(Map.get(arguments, "body"))),
           {:ok, _comment} <- write_parent_workpad(project, parent_id, comment, updated) do
        {:ok,
         %{
           tool: "define_shared_contract",
           message: "Defined shared contract #{id} (owner #{owner_unit}).",
           data: %{id: id, owner_unit: owner_unit, status: "draft"}
         }}
      end
    end
  end

  defp do_execute(project, "update_shared_contract", arguments, _opts) do
    with {:ok, parent_id} <- normalize_required_string(Map.get(arguments, "parent_identifier"), :parent_identifier),
         {:ok, id} <- normalize_required_string(Map.get(arguments, "id"), :id),
         {:ok, comment, body} <- read_parent_workpad(project, parent_id) do
      bundle = parsed_bundle(body)
      existing = Enum.find(bundle.shared_contracts, &(&1.id == id))
      new_body = normalize_optional_string(Map.get(arguments, "body"))
      requested_status = normalize_optional_string(Map.get(arguments, "status"))
      status = resolve_contract_status(existing, requested_status, new_body)

      contract =
        %{
          id: id,
          kind: contract_field(existing, :kind),
          owner_unit: contract_field(existing, :owner_unit),
          consumers: contract_field(existing, :consumers) || [],
          artifact: contract_field(existing, :artifact),
          status: status
        }

      with {:ok, updated} <- Store.upsert_contract(body, contract),
           updated <- append_contract_body(updated, id, new_body),
           {:ok, _comment} <- write_parent_workpad(project, parent_id, comment, updated) do
        {:ok,
         %{
           tool: "update_shared_contract",
           message: "Updated shared contract #{id} (status #{status}).",
           data: %{id: id, status: to_string(status)}
         }}
      end
    end
  end

  defp do_execute(_project, tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp parsed_bundle(body) do
    case ExecutionBundle.parse(body) do
      {:ok, bundle} -> bundle
      :absent -> %ExecutionBundle{version: 1, mode: "bundle", units: [], shared_contracts: []}
    end
  end

  defp bundle_data(%ExecutionBundle{} = bundle) do
    %{
      parent: bundle.parent,
      mode: bundle.mode,
      units: bundle.units,
      shared_contracts: bundle.shared_contracts
    }
  end

  # A body change to an already-ready contract flips it back to :changing so
  # consumers know to re-sync; otherwise honor the requested status.
  defp resolve_contract_status(%{status: :ready}, _requested, body) when is_binary(body), do: :changing
  defp resolve_contract_status(_existing, "ready", _body), do: :ready
  defp resolve_contract_status(_existing, "changing", _body), do: :changing
  defp resolve_contract_status(_existing, "draft", _body), do: :draft
  defp resolve_contract_status(%{status: status}, nil, _body) when not is_nil(status), do: status
  defp resolve_contract_status(_existing, _requested, _body), do: :draft

  defp contract_field(nil, _key), do: nil
  defp contract_field(contract, key), do: Map.get(contract, key)

  defp append_contract_body(workpad, _id, nil), do: workpad

  defp append_contract_body(workpad, id, body) do
    section = "### Shared contract: #{id}\n\n#{body}\n"

    if String.contains?(workpad, "### Shared contract: #{id}") do
      workpad
    else
      String.trim_trailing(workpad) <> "\n\n" <> section
    end
  end

  # A new parent must not be the issue itself nor one of its descendants.
  defp reject_reparent_cycle(_project, _identifier, nil), do: :ok

  defp reject_reparent_cycle(_project, identifier, identifier), do: {:error, {:reparent_cycle, identifier}}

  defp reject_reparent_cycle(project, identifier, new_parent) do
    if new_parent in descendant_identifiers(project, identifier, MapSet.new()) do
      {:error, {:reparent_cycle, new_parent}}
    else
      :ok
    end
  end

  defp descendant_identifiers(project, identifier, seen) do
    if MapSet.member?(seen, identifier) do
      []
    else
      seen = MapSet.put(seen, identifier)

      case Context.list_subtask_children(project_slug(project), identifier) do
        {:ok, children} ->
          children ++ Enum.flat_map(children, &descendant_identifiers(project, &1, seen))

        _error ->
          []
      end
    end
  end

  defp reparent_subtask(project, identifier, new_parent) do
    slug = project_slug(project)
    subtask_type = SymphonyElixir.LocalTracker.IssueRelation.subtask_type()

    {:ok, child} = IssueAdapter.dispatch(project, :get_issue, [identifier])
    old_parent = child.parent_identifier

    if old_parent do
      Context.delete_blocker(slug, identifier, old_parent, subtask_type)
      remove_bundle_unit(project, old_parent, identifier)
    end

    if new_parent do
      Context.add_blocker(slug, identifier, new_parent, subtask_type)
      {:ok, parent} = IssueAdapter.dispatch(project, :get_issue, [new_parent])

      type =
        case resolve_unit_type(%{}, child.repository_full_name, parent.repository_full_name) do
          {:ok, resolved} -> resolved
          _ -> :workpad_task
        end

      upsert_bundle_unit(project, parent, child, child.repository_full_name, type, %{})
    end

    {:ok,
     %{
       tool: "set_issue_parent",
       message: reparent_message(identifier, new_parent),
       data: %{subtask: identifier, parent: new_parent}
     }}
  end

  defp reparent_message(identifier, nil), do: "Detached #{identifier} to standalone."
  defp reparent_message(identifier, parent), do: "Reparented #{identifier} under #{parent}."

  defp remove_bundle_unit(project, parent_identifier, unit_id) do
    with {:ok, comment, body} when not is_nil(comment) <- read_parent_workpad(project, parent_identifier),
         {:ok, updated} <- Store.remove_unit(body, unit_id) do
      write_parent_workpad(project, parent_identifier, comment, updated)
    else
      _ -> {:ok, :noop}
    end
  end

  defp build_subtask_attrs(arguments, title) do
    %{"title" => title}
    |> maybe_put_attr("description", normalize_optional_string(Map.get(arguments, "description")))
  end

  defp resolve_unit_type(%{"unit_type" => t}, _repo, _parent_repo) when t in ["workpad_task", "child_run"],
    do: {:ok, String.to_existing_atom(t)}

  defp resolve_unit_type(arguments, repo, parent_repo) do
    unit = %{
      repo: repo,
      deliverable: normalize_optional_string(Map.get(arguments, "deliverable")),
      produces: normalize_string_list(Map.get(arguments, "produces")),
      consumes: normalize_string_list(Map.get(arguments, "consumes")),
      depends_on: normalize_string_list(Map.get(arguments, "depends_on"))
    }

    case Classifier.classify(unit, parent_repo: parent_repo) do
      {:ok, type, _rule} -> {:ok, type}
      {:ambiguous, reason} -> {:error, {:ambiguous_classification, reason}}
    end
  end

  # Records a local parent relation (source = child, target = parent). Works for
  # local projects and mirrors the relationship locally for synced trackers.
  defp link_subtask_parent(project, parent, child) do
    case Context.add_blocker(
           project_slug(project),
           child.identifier,
           parent.identifier,
           SymphonyElixir.LocalTracker.IssueRelation.subtask_type()
         ) do
      {:ok, _relation} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp upsert_bundle_unit(project, parent, child, repo, type, arguments) do
    unit = %{
      id: child.identifier,
      type: type,
      issue: child.identifier,
      repo: repo,
      produces: normalize_string_list(Map.get(arguments, "produces")),
      consumes: normalize_string_list(Map.get(arguments, "consumes")),
      depends_on: normalize_string_list(Map.get(arguments, "depends_on")),
      deliverable: normalize_optional_string(Map.get(arguments, "deliverable"))
    }

    with {:ok, comment, body} <- read_parent_workpad(project, parent.identifier),
         {:ok, updated} <- Store.upsert_unit(body, unit) do
      write_parent_workpad(project, parent.identifier, comment, updated)
    end
  end

  # Returns `{:ok, comment_or_nil, body}` for the parent's `## Codex Workpad`
  # comment, defaulting to a blank workpad body when none exists yet.
  defp read_parent_workpad(project, parent_identifier) do
    with {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [parent_identifier]) do
      case Enum.find(comments, &Workpad.workpad?(workpad_body(&1))) do
        nil -> {:ok, nil, "## Codex Workpad\n"}
        comment -> {:ok, comment, workpad_body(comment)}
      end
    end
  end

  defp write_parent_workpad(project, parent_identifier, nil, body) do
    IssueAdapter.dispatch(project, :add_comment, [parent_identifier, body, %{"author" => "assistant"}])
  end

  defp write_parent_workpad(project, parent_identifier, comment, body) do
    IssueAdapter.dispatch(project, :update_comment, [parent_identifier, workpad_comment_id(comment), body])
  end

  defp workpad_body(%{body: body}), do: body
  defp workpad_body(comment) when is_map(comment), do: Map.get(comment, :body) || Map.get(comment, "body")
  defp workpad_body(_comment), do: nil

  defp workpad_comment_id(%{id: id}), do: id
  defp workpad_comment_id(comment) when is_map(comment), do: Map.get(comment, :id) || Map.get(comment, "id")
  defp workpad_comment_id(_comment), do: nil

  defp bind_tool_spec_identifier(%{"name" => "get_issue", "inputSchema" => schema} = spec, identifier) do
    schema =
      schema
      |> update_in(["properties"], fn properties ->
        Map.put(properties || %{}, "identifier", bound_identifier_schema(identifier))
      end)
      |> update_in(["required"], &remove_bound_identifier_requirement/1)

    %{spec | "inputSchema" => schema}
  end

  defp bind_tool_spec_identifier(%{"name" => "read_workspace_file", "inputSchema" => schema} = spec, identifier) do
    issue_schema = %{
      "type" => "string",
      "const" => identifier,
      "description" => ToolText.msg("Bound issue workspace for %{identifier}.", %{identifier: identifier})
    }

    schema =
      schema
      |> update_in(["properties"], fn properties ->
        (properties || %{}) |> Map.put("issue_identifier", issue_schema)
      end)

    %{spec | "inputSchema" => schema}
  end

  defp bind_tool_spec_identifier(%{"name" => tool_name, "inputSchema" => schema} = spec, identifier)
       when tool_name in @issue_bound_mutable_tools do
    identifier_schema = %{
      "type" => "string",
      "const" => identifier,
      "description" => ToolText.msg("Bound issue identifier. Must be %{identifier}.", %{identifier: identifier})
    }

    schema =
      schema
      |> update_in(["properties"], fn properties ->
        Map.put(properties || %{}, "identifier", identifier_schema)
      end)
      |> update_in(["required"], &remove_bound_identifier_requirement/1)

    %{spec | "inputSchema" => schema}
  end

  defp bind_tool_spec_identifier(spec, _identifier), do: spec

  defp bound_identifier_schema(identifier) do
    %{
      "type" => "string",
      "const" => identifier,
      "description" => ToolText.msg("Bound issue identifier. Must be %{identifier}.", %{identifier: identifier})
    }
  end

  defp remove_bound_identifier_requirement(required) when is_list(required) do
    Enum.reject(required, &(&1 == "identifier"))
  end

  defp remove_bound_identifier_requirement(required), do: required

  defp bind_issue_tool_arguments(tool_name, _arguments, _identifier) when tool_name not in @issue_bound_supported_tools do
    {:error, {:unsupported_issue_bound_tool, tool_name}}
  end

  defp bind_issue_tool_arguments("get_issue", arguments, identifier) do
    bind_mutable_identifier("get_issue", arguments, identifier)
  end

  defp bind_issue_tool_arguments("read_workspace_file", arguments, identifier) do
    {:ok, Map.put(arguments, "issue_identifier", identifier)}
  end

  defp bind_issue_tool_arguments(tool_name, arguments, identifier) when tool_name in @issue_bound_mutable_tools do
    bind_mutable_identifier(tool_name, arguments, identifier)
  end

  defp bind_issue_tool_arguments(_tool_name, arguments, _identifier), do: {:ok, arguments}

  defp bind_mutable_identifier(_tool_name, arguments, identifier) do
    case normalize_optional_string(Map.get(arguments, "identifier")) do
      nil ->
        {:ok, Map.put(arguments, "identifier", identifier)}

      ^identifier ->
        {:ok, Map.put(arguments, "identifier", identifier)}

      actual ->
        {:error, {:issue_identifier_mismatch, identifier, actual}}
    end
  end

  defp maybe_put_bound_issue(opts) do
    case Keyword.get(opts, :bound_issue_identifier) do
      identifier when is_binary(identifier) -> Keyword.put_new(opts, :bound_issue_identifier, identifier)
      _ -> opts
    end
  end

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end

  defp string_schema(description), do: %{"type" => ["string", "null"], "description" => description}

  defp string_list_schema(description) do
    %{
      "type" => ["array", "null"],
      "items" => %{"type" => "string"},
      "description" => description
    }
  end

  defp normalize_assignee_arguments(arguments) when is_map(arguments) do
    cond do
      Map.has_key?(arguments, "assignee_ids") ->
        arguments

      Map.has_key?(arguments, "assignee_id") ->
        case normalize_optional_string(Map.get(arguments, "assignee_id")) do
          nil -> Map.delete(arguments, "assignee_id")
          login -> arguments |> Map.delete("assignee_id") |> Map.put("assignee_ids", [login])
        end

      true ->
        arguments
    end
  end

  defp maybe_put_assignee_ids(attrs, arguments) do
    ids =
      arguments
      |> normalize_assignee_arguments()
      |> Map.get("assignee_ids")
      |> normalize_string_list()

    maybe_put_attr(attrs, "assignee_ids", ids)
  end

  defp ensure_in_dispatch_queue(project, issue) do
    dispatch_states = project_dispatch_states(project)
    current = issue_status_name(issue)

    if Enum.any?(dispatch_states, &(normalize_status_name(&1) == normalize_status_name(current))) do
      :ok
    else
      {:error, "Issue must be in orchestrator queue #{inspect(dispatch_states)} before dispatch. Current status: #{current}. Use move_issue first."}
    end
  end

  defp dispatch_queue_status?(project, status) do
    normalized = normalize_status_name(status)

    project_dispatch_states(project)
    |> Enum.any?(&(normalize_status_name(&1) == normalized))
  end

  defp project_dispatch_states(project) do
    project
    |> Repo.preload(:setup)
    |> ProjectConfig.resolve()
    |> Map.get(:dispatch_states, Config.dispatch_states())
    |> List.wrap()
  end

  defp issue_status_name(%{status: %{name: name}}) when is_binary(name), do: name
  defp issue_status_name(%{status: %{"name" => name}}) when is_binary(name), do: name
  defp issue_status_name(%IssueDTO{status: %{name: name}}) when is_binary(name), do: name
  defp issue_status_name(_issue), do: ""

  defp repository_list_schema do
    %{
      "type" => "array",
      "description" => "Full replacement list. Each entry needs github_full_name, workspace_path, and role. Optional: clone_url, default_branch, selected_branch, local_path, scan_summary.",
      "items" => %{
        "type" => "object",
        "additionalProperties" => true,
        "required" => ["github_full_name", "workspace_path", "role"],
        "properties" => %{
          "github_full_name" => %{"type" => "string", "description" => "GitHub repo, e.g. GambaLabs/frontend."},
          "clone_url" => string_schema("Optional git clone URL."),
          "default_branch" => string_schema("Optional default branch from GitHub."),
          "selected_branch" => string_schema("Optional branch Symphony checks out."),
          "local_path" => string_schema("Optional absolute path on the host for discovery scans."),
          "workspace_path" => %{
            "type" => "string",
            "description" => "Relative path under the project workspace root (unique per project)."
          },
          "role" => %{"type" => "string", "description" => "Repo role label, e.g. frontend or backend."},
          "scan_summary" => %{"type" => "object", "description" => "Optional discovery metadata."}
        }
      }
    }
  end

  defp normalize_repository_list(repositories) when is_list(repositories), do: {:ok, repositories}

  defp normalize_repository_list(_repositories),
    do: {:error, {:invalid_repositories, "repositories must be a list"}}

  defp replace_project_repositories(slug, repositories) do
    case Context.replace_repositories(slug, repositories) do
      {:ok, inserted} -> {:ok, inserted}
      {:error, %Ecto.Changeset{} = changeset} -> {:error, {:invalid_changeset, changeset}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp goal_tool_error(reason) when is_binary(reason), do: reason
  defp goal_tool_error(reason), do: reason

  defp codex_success_response(result) do
    payload = stringify_keys(%{tool: result.tool, message: result.message, data: result.data})

    %{
      "success" => true,
      "contentItems" => [%{"type" => "inputText", "text" => encode_payload(payload)}],
      "toolResult" => payload
    }
  end

  defp codex_failure_response({:template_not_found, slug}) do
    slugs =
      SymphonyElixir.LocalTracker.Templates.list_templates()
      |> Enum.map_join(", ", & &1.slug)

    codex_failure_response("Template #{inspect(slug)} not found. Available templates: #{slugs}. Call list_templates for details.")
  end

  defp codex_failure_response(:template_not_found) do
    codex_failure_response({:template_not_found, "unknown"})
  end

  defp codex_failure_response({:unsupported_tool, tool}) do
    codex_failure_response("Unsupported assistant tool: #{tool}.")
  end

  defp codex_failure_response(:workflow_example_not_found) do
    codex_failure_response("Workflow example not found beside the running WORKFLOW file.")
  end

  defp codex_failure_response(:path_escape) do
    codex_failure_response("Path escapes the workspace root.")
  end

  defp codex_failure_response(:file_not_found) do
    codex_failure_response("File not found in the workspace.")
  end

  defp codex_failure_response(:missing_github_token) do
    codex_failure_response("GITHUB_TOKEN is not configured on the Symphony server (elixir/.env).")
  end

  defp codex_failure_response(:missing_jira_credentials) do
    codex_failure_response("Jira credentials are not configured on the Symphony server (jira: section in WORKFLOW.md or JIRA_* env vars).")
  end

  defp codex_failure_response(:disabled) do
    codex_failure_response("Dev-server preview is disabled in this project's workflow.")
  end

  defp codex_failure_response({:invalid_changeset, changeset}) do
    codex_failure_response("Invalid project attributes: #{inspect(changeset.errors)}")
  end

  defp codex_failure_response({:invalid_preview_action, action}) do
    codex_failure_response("Invalid preview action: #{inspect(action)}. Use status, start, stop, or restart.")
  end

  defp codex_failure_response({:invalid_workflow_markdown, reason}) do
    codex_failure_response("Invalid workflow_markdown: #{reason}")
  end

  defp codex_failure_response(:repository_not_found) do
    codex_failure_response("GitHub repository not found for the given repo.")
  end

  defp codex_failure_response({:missing_required_field, field}) do
    codex_failure_response("Missing required field: #{field}.")
  end

  defp codex_failure_response(:missing_action) do
    codex_failure_response("action is required for manage_codex_goal.")
  end

  defp codex_failure_response(:invalid_context) do
    codex_failure_response("context must be authoring or execution.")
  end

  defp codex_failure_response(:empty_objective) do
    codex_failure_response("objective is required for set_objective.")
  end

  defp codex_failure_response(:invalid_budget) do
    codex_failure_response("token_budget must be a positive integer or null.")
  end

  defp codex_failure_response(:goals_disabled) do
    codex_failure_response("Codex goal mode is disabled for this project.")
  end

  defp codex_failure_response({:invalid_action, action}) do
    codex_failure_response("Invalid manage_codex_goal action: #{inspect(action)}.")
  end

  defp codex_failure_response(reason) do
    payload = %{"error" => %{"message" => "Assistant tool execution failed.", "reason" => inspect(reason)}}

    if is_binary(reason) do
      failure_response(%{"error" => %{"message" => reason}})
    else
      failure_response(payload)
    end
  end

  defp failure_response(payload) do
    %{
      "success" => false,
      "contentItems" => [%{"type" => "inputText", "text" => encode_payload(payload)}]
    }
  end

  defp encode_payload(payload), do: Jason.encode!(payload, pretty: true)

  defp stringify_keys(value) when is_map(value) do
    Map.new(value, fn {key, nested_value} -> {to_string(key), stringify_keys(nested_value)} end)
  end

  defp stringify_keys(value) when is_list(value), do: Enum.map(value, &stringify_keys/1)
  defp stringify_keys(value), do: value

  defp project_execution?(execution, issue_ids, issue_identifiers) do
    case Map.get(execution, :issue_id) do
      issue_id when is_binary(issue_id) -> MapSet.member?(issue_ids, issue_id)
      issue_id when not is_nil(issue_id) -> MapSet.member?(issue_ids, to_string(issue_id))
      nil -> MapSet.member?(issue_identifiers, Map.get(execution, :issue_identifier))
    end
  end

  defp ensure_status_available(project, status_name) do
    with {:ok, statuses} <- IssueAdapter.dispatch(project, :list_statuses, []) do
      if Enum.any?(statuses, &(Map.get(&1, :name) == status_name or Map.get(&1, "name") == status_name)) do
        :ok
      else
        {:error, :status_not_found}
      end
    end
  end

  defp resolve_create_status(project, status) when is_binary(status) do
    case normalize_optional_string(status) do
      nil ->
        resolve_create_status(project, nil)

      explicit ->
        if dispatch_queue_status?(project, explicit) do
          {:error, "Cannot create issues directly in #{explicit}. Omit status to use Backlog (intake), then move_issue to #{explicit} when ready for agent execution."}
        else
          {:ok, explicit}
        end
    end
  end

  defp resolve_create_status(project, _status) do
    case IssueAdapter.dispatch(project, :list_statuses, []) do
      {:ok, statuses} when is_list(statuses) and statuses != [] ->
        {:ok, pick_create_status(statuses)}

      _ ->
        {:ok, "Backlog"}
    end
  end

  defp pick_create_status(statuses) do
    case Enum.find(statuses, &(normalize_status_name(status_field(&1, :name)) == "backlog" && !terminal_status?(&1))) do
      match when is_map(match) ->
        status_field(match, :name) || "Backlog"

      _ ->
        non_dispatchable_draft_status(statuses) || "Backlog"
    end
  end

  defp build_create_attrs(arguments, title, status) do
    %{
      "title" => title,
      "description" => Map.get(arguments, "description"),
      "status" => status
    }
    |> maybe_put_attr("priority", Map.get(arguments, "priority"))
    |> maybe_put_attr("agent", normalize_optional_string(Map.get(arguments, "agent")))
    |> maybe_put_attr("label_ids", normalize_string_list(Map.get(arguments, "label_ids")))
    |> maybe_put_assignee_ids(arguments)
  end

  defp build_draft_attrs(arguments, title, status) do
    %{
      "title" => title,
      "description" => normalize_optional_string(Map.get(arguments, "description")),
      "status" => status
    }
  end

  @draft_category_priority %{"backlog" => 0, "unstarted" => 1}
  @draft_category_fallback 2

  defp resolve_draft_status(project) do
    configured = Config.assistant_draft_status()

    case IssueAdapter.dispatch(project, :list_statuses, []) do
      {:ok, statuses} when is_list(statuses) and statuses != [] ->
        {:ok, pick_draft_status(statuses, configured)}

      _ ->
        {:ok, configured}
    end
  end

  defp pick_draft_status(statuses, configured) do
    normalized_configured = normalize_status_name(configured)

    case Enum.find(statuses, &(normalize_status_name(status_field(&1, :name)) == normalized_configured)) do
      match when is_map(match) ->
        status_field(match, :name) || configured

      _ ->
        non_dispatchable_draft_status(statuses) || configured
    end
  end

  defp non_dispatchable_draft_status(statuses) do
    dispatch_states = MapSet.new(Config.dispatch_states(), &normalize_status_name/1)

    candidates =
      statuses
      |> Enum.reject(&terminal_status?/1)
      |> Enum.reject(&MapSet.member?(dispatch_states, normalize_status_name(status_field(&1, :name))))

    candidates
    |> fallback_candidates(statuses)
    |> Enum.min_by(&draft_sort_key/1, fn -> nil end)
    |> case do
      status when is_map(status) -> status_field(status, :name)
      _ -> nil
    end
  end

  defp fallback_candidates([], statuses), do: Enum.reject(statuses, &terminal_status?/1)
  defp fallback_candidates(candidates, _statuses), do: candidates

  defp draft_sort_key(status) do
    category = status |> status_field(:category) |> normalize_status_name()
    position = status_field(status, :position)

    {
      Map.get(@draft_category_priority, category, @draft_category_fallback),
      normalize_position(position)
    }
  end

  defp normalize_position(position) when is_integer(position), do: position
  defp normalize_position(_position), do: 1_000_000

  defp terminal_status?(status), do: status_field(status, :is_terminal) == true

  defp status_field(status, key) when is_map(status) do
    Map.get(status, key) || Map.get(status, to_string(key))
  end

  defp status_field(_status, _key), do: nil

  defp normalize_status_name(name) when is_binary(name), do: name |> String.trim() |> String.downcase()
  defp normalize_status_name(_name), do: ""

  defp comment_attrs(arguments) do
    %{}
    |> maybe_put_attr("author", normalize_optional_string(Map.get(arguments, "author")) || "assistant")
    |> maybe_put_attr("kind", normalize_optional_string(Map.get(arguments, "kind")) || "comment")
  end

  defp codex_comment(instructions) do
    "## Codex work requested from tracker assistant\n\n" <> instructions
  end

  defp resolve_dispatch_agent(project, identifier, explicit) do
    case AgentPreference.normalize(explicit) do
      nil ->
        project_kind = project |> ProjectConfig.resolve() |> Map.get(:agent_kind)
        task_labels = issue_label_names(project, identifier)
        {:ok, AgentPreference.resolve(task_labels, project_kind)}

      kind ->
        {:ok, kind}
    end
  end

  defp issue_label_names(project, identifier) do
    case IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      {:ok, %IssueDTO{labels: labels}} -> labels
      _ -> []
    end
  end

  defp agent_display("claude"), do: "Claude"
  defp agent_display("cursor"), do: "Cursor"
  defp agent_display(_), do: "Codex"

  # Persist the long-running objective for both agents: Codex consumes it as a
  # native goal; Claude receives it as workflow guidance in its prompt.
  defp dispatch_agent_attrs(agent, arguments) do
    %{
      "status" => @in_progress_state,
      "agent" => agent,
      "agent_goal" => normalize_optional_string(Map.get(arguments, "goal"))
    }
  end

  defp normalize_required_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_required_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_required_string(_value, field), do: {:error, {:missing_required_field, field}}

  defp normalize_comment_id(id) when is_integer(id), do: {:ok, id}

  defp normalize_comment_id(id) when is_binary(id) do
    case String.trim(id) do
      "" -> {:error, :missing_comment_id}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_comment_id(_id), do: {:error, :missing_comment_id}

  defp normalize_issue_identifier!(issue_identifier) do
    case normalize_required_string(issue_identifier, :issue_identifier) do
      {:ok, identifier} -> identifier
      {:error, reason} -> raise ArgumentError, "invalid issue identifier: #{inspect(reason)}"
    end
  end

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil

  defp normalize_string_list(value) when is_list(value) do
    value
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp normalize_string_list(_value), do: []

  defp maybe_put_filter(filters, _key, nil), do: filters
  defp maybe_put_filter(filters, _key, ""), do: filters
  defp maybe_put_filter(filters, key, value) when is_binary(value), do: Keyword.put(filters, key, String.trim(value))
  defp maybe_put_filter(filters, _key, _value), do: filters

  defp maybe_put_attr(attrs, _key, nil), do: attrs
  defp maybe_put_attr(attrs, _key, []), do: attrs
  defp maybe_put_attr(attrs, key, value), do: Map.put(attrs, key, value)

  defp project_slug(%{slug: slug}) when is_binary(slug), do: slug
  defp project_slug(%{"slug" => slug}) when is_binary(slug), do: slug

  defp validate_workflow_markdown(markdown) when is_binary(markdown) do
    case Config.parse_workflow_markdown(markdown) do
      {:ok, %{front_matter: _, body: _}} -> :ok
      {:error, reason} -> {:error, {:invalid_workflow_markdown, reason}}
    end
  end
end
