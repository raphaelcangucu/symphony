defmodule SymphonyElixir.MobileRpc.MobilePresenter do
  @moduledoc """
  Adapts Symphony's host-owned project and session services to the stable
  response shapes consumed by the vendored mobile interface.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context

  @state_table :symphony_mobile_rpc_orca_state
  # Keep these aligned with the pinned Orca runtime compatibility contract.
  # They are intentionally separate from Symphony's E2EE wire protocol v1.
  @runtime_protocol_version 3
  @min_compatible_mobile_version 2
  @default_settings %{
    "defaultTaskSource" => "dev10x",
    "defaultRepoSelection" => nil,
    "defaultTaskViewPreset" => nil,
    "defaultLinearTeamSelection" => nil,
    "githubProjects" => %{
      "pinned" => [],
      "recent" => [],
      "lastViewByProject" => %{},
      "activeProject" => nil
    },
    "visibleTaskProviders" => ["dev10x"],
    "disabledTuiAgents" => [],
    "agentCmdOverrides" => %{}
  }

  @spec present_host(map(), [String.t()]) :: map()
  def present_host(identity, capabilities \\ []) do
    %{
      "runtimeId" => Map.fetch!(identity, :host_id),
      "product" => "Symphony",
      "displayName" => Map.get(identity, :host_name, "Symphony host"),
      "version" => Map.get(identity, :host_version, "development"),
      "protocolVersion" => @runtime_protocol_version,
      "minCompatibleMobileVersion" => @min_compatible_mobile_version,
      "capabilities" => capabilities
    }
  end

  @spec call(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def call("status.get", _params, context) do
    capabilities = ["mobile.tasks.v1" | Map.get(context, :capabilities, [])] |> Enum.uniq()
    {:ok, present_host(context, capabilities)}
  end

  def call("settings.get", _params, context) do
    {:ok, %{"settings" => state(context, :settings, @default_settings)}}
  end

  def call("settings.update", params, context) do
    settings = merge_state(context, :settings, @default_settings, params)
    {:ok, %{"settings" => settings}}
  end

  def call("preflight.check", _params, _context) do
    {:ok,
     %{
       "git" => %{"installed" => executable?("git")},
       "gh" => %{"installed" => executable?("gh")},
       "glab" => %{"installed" => executable?("glab")}
     }}
  end

  def call(method, _params, context)
      when method in ["preflight.detectAgents", "preflight.detectRemoteAgents"] do
    {:ok, detected_agents(context)}
  end

  def call("stats.summary", _params, context) do
    worktrees = worktrees(context)

    {:ok,
     %{
       "totalAgentsSpawned" => Enum.count(worktrees, &(&1["liveTerminalCount"] > 0)),
       "totalPRsCreated" => Enum.count(worktrees, &(not is_nil(&1["linkedPR"]))),
       "totalAgentTimeMs" => 0,
       "firstEventAt" => nil
     }}
  end

  def call("accounts.list", _params, context), do: {:ok, accounts_snapshot(context)}

  def call("repo.list", _params, context), do: {:ok, %{"repos" => repos(context)}}

  def call("repo.hooks", %{"repo" => selector}, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      {:ok,
       %{
         "hooks" => %{"scripts" => %{}},
         "setupRunPolicy" => "run-by-default",
         "source" => repo["path"]
       }}
    end
  end

  def call("repo.searchRefs", %{"repo" => selector} = params, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      refs =
        repo["path"]
        |> git_refs()
        |> filter_refs(Map.get(params, "query", ""))
        |> Enum.take(Map.get(params, "limit", 20))

      {:ok, %{"refs" => refs, "refDetails" => Enum.map(refs, &%{"refName" => &1, "localBranchName" => &1})}}
    end
  end

  def call("repo.baseRefDefault", %{"repo" => selector}, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      {:ok, %{"defaultBaseRef" => default_base_ref(repo["path"])}}
    end
  end

  def call("repo.sparsePresets", %{"repo" => selector}, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      presets = state(context, {:sparse_presets, repo["id"]}, [])
      {:ok, %{"presets" => presets}}
    end
  end

  def call("repo.saveSparsePreset", %{"repo" => selector} = params, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      id = Map.get(params, "id") || "preset-#{System.unique_integer([:positive])}"

      preset = %{
        "id" => id,
        "name" => params["name"],
        "directories" => params["directories"]
      }

      key = {:sparse_presets, repo["id"]}
      presets = state(context, key, []) |> Enum.reject(&(&1["id"] == id)) |> Kernel.++([preset])
      put_state(context, key, presets)
      {:ok, %{"preset" => preset}}
    end
  end

  def call("ui.get", _params, context), do: {:ok, %{"ui" => state(context, :ui, %{})}}

  def call("ui.set", params, context) do
    ui = merge_state(context, :ui, %{}, params)
    {:ok, %{"ui" => ui}}
  end

  def call("worktree.ps", params, context) do
    {:ok, %{"worktrees" => Enum.take(worktrees(context), Map.get(params, "limit", 200))}}
  end

  def call("worktree.show", %{"worktree" => selector}, context) do
    with {:ok, worktree} <- find_worktree(context, selector) do
      {:ok, %{"worktree" => worktree}}
    end
  end

  def call("worktree.create", params, context) do
    create_worktree(params, context)
  end

  def call("worktree.activate", %{"worktree" => selector}, context) do
    with {:ok, worktree} <- find_worktree(context, selector) do
      {:ok, %{"worktree" => Map.put(worktree, "isActive", true)}}
    end
  end

  def call("worktree.set", %{"worktree" => selector} = params, context) do
    with {:ok, worktree} <- find_worktree(context, selector),
         {:ok, updated} <- update_worktree(worktree, Map.delete(params, "worktree"), context) do
      {:ok, %{"worktree" => updated}}
    end
  end

  def call("worktree.sleep", %{"worktree" => selector}, context) do
    with {:ok, worktree} <- find_worktree(context, selector),
         {:ok, updated} <- update_worktree(worktree, %{"status" => "inactive"}, context) do
      {:ok, %{"worktree" => updated}}
    end
  end

  def call("worktree.rm", %{"worktree" => selector}, context) do
    with {:ok, worktree} <- find_worktree(context, selector),
         :ok <- delete_worktree(worktree, context) do
      {:ok, %{"removed" => true, "worktreeId" => worktree["worktreeId"]}}
    end
  end

  def call(_method, _params, _context), do: {:error, :unsupported_orca_method}

  @spec accounts_snapshot(map()) :: map()
  def accounts_snapshot(context) do
    Map.get(context, :orca_accounts) ||
      %{
        "claude" => %{"accounts" => [], "activeAccountId" => nil},
        "codex" => %{"accounts" => [], "activeAccountId" => nil},
        "rateLimits" => %{
          "claude" => nil,
          "codex" => nil,
          "inactiveClaudeAccounts" => [],
          "inactiveCodexAccounts" => []
        }
      }
  end

  defp repos(context) do
    case Map.get(context, :orca_repos) do
      repos when is_list(repos) ->
        repos

      _ ->
        Context.list_projects()
        |> Enum.map(fn project ->
          path = Path.join(SymphonyElixir.Config.workspace_root(), project.slug)

          %{
            "id" => project.slug,
            "displayName" => project.name,
            "path" => path,
            "badgeColor" => badge_color(project.slug),
            "addedAt" => DateTime.to_unix(project.inserted_at || DateTime.utc_now(), :millisecond),
            "kind" => "git",
            "executionHostId" => "local"
          }
        end)
    end
  rescue
    _error -> []
  end

  defp worktrees(context) do
    case Map.get(context, :orca_worktrees) do
      worktrees when is_list(worktrees) ->
        worktrees

      _ ->
        History.list_threads(limit: 10_000, include_archived: true)
        |> Enum.map(&present_thread/1)
    end
  rescue
    _error -> []
  end

  defp present_thread(thread) do
    metadata = thread.metadata || %{}
    id = to_string(thread.id)
    project_slug = thread.project_slug || "freeform"
    status = worktree_status(thread.status)
    display_name = thread.title || Path.basename(thread.workspace_path || project_slug)

    %{
      "worktreeId" => id,
      "id" => id,
      "repoId" => project_slug,
      "repo" => project_slug,
      "branch" => Map.get(metadata, "branch", display_name),
      "displayName" => display_name,
      "path" => thread.workspace_path,
      "sessionScope" => thread.scope,
      "issueIdentifier" => thread.issue_identifier,
      "agentKind" => thread.agent_kind,
      "liveTerminalCount" => if(status in ["active", "working", "permission"], do: 1, else: 0),
      "hasAttachedPty" => status in ["active", "working", "permission"],
      "preview" => Map.get(metadata, "preview", ""),
      "unread" => Map.get(metadata, "unread", false),
      "isPinned" => Map.get(metadata, "isPinned", false),
      "isActive" => thread.status == "active",
      "linkedPR" => Map.get(metadata, "linkedPR"),
      "linkedIssue" => Map.get(metadata, "linkedIssue"),
      "comment" => Map.get(metadata, "comment", ""),
      "status" => status,
      "diffComments" => Map.get(metadata, "diffComments", [])
    }
  end

  defp create_worktree(%{"repo" => selector} = params, context) do
    with {:ok, repo} <- find_repo(context, selector) do
      bridge = Map.get(context, :tracker_bridge, SymphonyElixir.MobileRpc.TrackerBridge)

      request = %{
        "path" => "/assistant/threads",
        "method" => "POST",
        "idempotency_key" => Map.get(params, "clientRequestId") || Ecto.UUID.generate(),
        "body" => %{
          "scope" => "project_session",
          "project_slug" => repo["id"],
          "title" => Map.get(params, "name"),
          "agent_kind" => Map.get(params, "createdWithAgent"),
          "metadata" =>
            %{
              "comment" => Map.get(params, "comment", ""),
              "baseRef" => Map.get(params, "baseRef"),
              "sparseDirectories" => Map.get(params, "sparseDirectories")
            }
            |> Enum.reject(fn {_key, value} -> is_nil(value) end)
            |> Map.new()
        }
      }

      with {:ok, payload} <- bridge.request(:sessions, request, context),
           thread when is_map(thread) <- Map.get(payload, "data") do
        id = to_string(thread["id"])

        {:ok,
         %{
           "worktree" => %{
             "id" => id,
             "worktreeId" => id,
             "repoId" => repo["id"],
             "displayName" => thread["title"] || params["name"],
             "path" => thread["workspace_path"]
           }
         }}
      else
        nil -> {:error, :invalid_create_response}
        error -> error
      end
    end
  end

  defp create_worktree(_params, _context), do: {:error, :invalid_params}

  defp update_worktree(worktree, patch, context) do
    case fixture_worktrees?(context) do
      true ->
        {:ok, Map.merge(worktree, patch)}

      false ->
        with {:ok, id} <- parse_selector(worktree["worktreeId"]),
             {:ok, thread} <- History.get_thread(id) do
          metadata_patch =
            patch
            |> Map.drop(["displayName", "status"])
            |> then(&Map.merge(thread.metadata || %{}, &1))

          attrs =
            %{metadata: metadata_patch}
            |> maybe_put(:title, patch["displayName"])
            |> maybe_put(:status, symphony_status(patch["status"]))

          case History.update_thread(thread, attrs) do
            {:ok, updated} -> {:ok, present_thread(updated)}
            error -> error
          end
        end
    end
  end

  defp delete_worktree(_worktree, context) when is_map_key(context, :orca_worktrees), do: :ok

  defp delete_worktree(worktree, _context) do
    with {:ok, id} <- parse_selector(worktree["worktreeId"]),
         {:ok, _thread} <- History.delete_thread(id) do
      :ok
    end
  end

  defp find_repo(context, selector) do
    id = strip_selector(selector)

    case Enum.find(repos(context), &(&1["id"] == id)) do
      nil -> rpc_error("not_found", "Repository was not found")
      repo -> {:ok, repo}
    end
  end

  defp find_worktree(context, selector) do
    id = strip_selector(selector)

    case Enum.find(worktrees(context), &((&1["worktreeId"] || &1["id"]) == id)) do
      nil -> rpc_error("not_found", "Workspace was not found")
      worktree -> {:ok, worktree}
    end
  end

  defp detected_agents(context) do
    Map.get(context, :orca_detected_agents) ||
      SymphonyElixir.Settings.Agents.agent_kinds()
  rescue
    _error -> ["codex", "claude"]
  end

  defp git_refs(path) when is_binary(path) do
    case System.cmd("git", ["-C", path, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], stderr_to_stdout: true) do
      {output, 0} -> output |> String.split("\n", trim: true) |> Enum.uniq()
      _ -> []
    end
  rescue
    _error -> []
  end

  defp git_refs(_path), do: []

  defp default_base_ref(path) do
    case System.cmd("git", ["-C", path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], stderr_to_stdout: true) do
      {ref, 0} -> String.trim(ref)
      _ -> "main"
    end
  rescue
    _error -> "main"
  end

  defp filter_refs(refs, ""), do: refs
  defp filter_refs(refs, query), do: Enum.filter(refs, &String.contains?(&1, query))

  defp executable?(name), do: not is_nil(System.find_executable(name))

  defp state(context, key, default) do
    ensure_state_table()
    :ets.lookup_element(@state_table, {Map.get(context, :host_id, "default"), key}, 2, default)
  end

  defp put_state(context, key, value) do
    ensure_state_table()
    :ets.insert(@state_table, {{Map.get(context, :host_id, "default"), key}, value})
    value
  end

  defp merge_state(context, key, default, patch) do
    context
    |> state(key, default)
    |> Map.merge(patch)
    |> then(&put_state(context, key, &1))
  end

  defp ensure_state_table do
    case :ets.whereis(@state_table) do
      :undefined ->
        try do
          :ets.new(@state_table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> @state_table
        end

      table ->
        table
    end
  end

  defp strip_selector("id:" <> id), do: id
  defp strip_selector(id), do: to_string(id)

  defp parse_selector(selector) do
    case Integer.parse(strip_selector(selector)) do
      {id, ""} when id > 0 -> {:ok, id}
      _ -> {:error, :invalid_worktree}
    end
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp fixture_worktrees?(context), do: is_list(Map.get(context, :orca_worktrees))

  defp symphony_status("inactive"), do: "closed"
  defp symphony_status("done"), do: "closed"
  defp symphony_status("permission"), do: "error"
  defp symphony_status(status) when status in ["active", "closed", "error", "archived"], do: status
  defp symphony_status(_status), do: nil

  defp worktree_status("active"), do: "active"
  defp worktree_status("error"), do: "permission"
  defp worktree_status(status) when status in ["closed", "archived"], do: "inactive"
  defp worktree_status(_status), do: "inactive"

  defp badge_color(value) do
    colors = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#DC2626", "#DB2777"]
    Enum.at(colors, :erlang.phash2(value, length(colors)))
  end

  defp rpc_error(code, message),
    do: {:error, {:rpc_error, code, message, false, nil}}
end
