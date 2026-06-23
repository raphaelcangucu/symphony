defmodule SymphonyElixir.AgentRunner do
  @moduledoc """
  Executes a single issue in an isolated workspace with the configured coding agent.
  """

  require Logger

  alias SymphonyElixir.{
    AgentPreference,
    CodingAgent,
    Config,
    InstanceConfig,
    Issue,
    ProjectConfig,
    PromptBuilder,
    Repo,
    RunContract,
    Tracker,
    Workspace
  }

  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.Evidence
  alias SymphonyElixir.GitHub.Client, as: GitHubClient
  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workpad.ExecutionContract

  # The open-PR check runs every turn for "In Progress" issues; cache it per
  # repo+issue so a long-running issue does not re-query GitHub each turn.
  @open_pr_cache_ttl_ms 120_000

  # Extra turns granted to fix publish-gate violations before the orchestrator
  # falls back to the mechanical finalizer.
  @max_corrective_turns 2

  # Small pause between continuation turns. Defends against tight zero-work loops
  # (e.g. a turn that completes almost instantly) by keeping the agent from
  # hammering the model/API back-to-back. Overridable via opts for tests.
  @continuation_delay_ms 2_000

  @type run_outcome ::
          :completed
          | {:error, term()}
          | {:incomplete, :max_turns | {:publish_gate, [map()]} | {:validate_gate, [map()]}}

  @spec run(map(), pid() | nil, keyword()) :: :ok
  def run(issue, codex_update_recipient \\ nil, opts \\ []) do
    agent_kind = issue_agent_kind(issue)

    opts =
      opts
      |> issue_goal_opts(issue, agent_kind)
      |> Keyword.put(:agent_kind, agent_kind)
      |> Keyword.put_new_lazy(:project_config, fn -> resolve_project_config(issue) end)

    Logger.info("Starting agent run for #{issue_context(issue)}")

    outcome = do_run(issue, codex_update_recipient, opts)
    report_outcome(codex_update_recipient, issue, outcome)
    :ok
  end

  @spec do_run(map(), pid() | nil, keyword()) :: run_outcome()
  defp do_run(issue, codex_update_recipient, opts) do
    case Workspace.create_for_issue(issue) do
      {:ok, workspace} ->
        try do
          case Workspace.run_before_run_hook(workspace, issue) do
            :ok ->
              workspace
              |> run_codex_turns(issue, codex_update_recipient, opts)
              |> handle_turns_result(issue)

            {:error, reason} ->
              failed_run(issue, reason)
          end
        after
          Workspace.run_after_run_hook(workspace, issue)
        end

      {:error, reason} ->
        failed_run(issue, reason)
    end
  end

  defp handle_turns_result(:completed, _issue), do: :completed
  defp handle_turns_result({:incomplete, _reason} = outcome, _issue), do: outcome
  defp handle_turns_result({:error, reason}, issue), do: failed_run(issue, reason)

  @spec failed_run(map(), term()) :: {:error, term()}
  defp failed_run(issue, reason) do
    Logger.error("Agent run failed for #{issue_context(issue)}: #{inspect(reason)}")
    {:error, reason}
  end

  defp report_outcome(recipient, %Issue{id: id}, outcome)
       when is_pid(recipient) and is_binary(id) do
    send(recipient, {:agent_outcome, id, outcome})
    :ok
  end

  defp report_outcome(_recipient, _issue, _outcome), do: :ok

  defp codex_message_handler(recipient, issue, agent_kind) do
    fn message ->
      normalized = CodingAgent.normalize_event(message, agent_kind)
      send_codex_update(recipient, issue, normalized)
    end
  end

  @spec issue_agent_kind(SymphonyElixir.Issue.t()) :: String.t()
  def issue_agent_kind(%Issue{} = issue) do
    task_kind = AgentPreference.normalize(issue.agent_kind)
    AgentPreference.resolve(task_labels(task_kind), project_agent_kind(issue))
  end

  def issue_agent_kind(_issue), do: AgentPreference.resolve([], nil)

  defp task_labels(nil), do: []
  defp task_labels(kind), do: ["symphony:" <> kind]

  defp project_agent_kind(%Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        project |> Repo.preload(:setup) |> ProjectConfig.resolve() |> Map.get(:agent_kind)

      {:error, _reason} ->
        nil
    end
  end

  defp project_agent_kind(_issue), do: nil

  @spec resolve_project_config(Issue.t()) :: ProjectConfig.t() | nil
  defp resolve_project_config(%Issue{project_slug: slug}) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} -> project |> Repo.preload(:setup) |> ProjectConfig.resolve()
      _ -> nil
    end
  end

  defp resolve_project_config(_issue), do: nil

  # Goal mode is driven by the durable native Codex goal thread, not by a cached
  # objective. A Codex issue that owns a goal thread (`agent_session_id`) runs in
  # goal mode so the run resumes that thread and pursues its native goal; an
  # explicit `opts[:goal]` still forces goal mode for direct/ad-hoc runs.
  defp issue_goal_opts(opts, issue, agent_kind) do
    cond do
      Keyword.has_key?(opts, :goal) ->
        Keyword.put_new(opts, :goal_mode, true)

      agent_kind == "codex" and codex_goal_thread?(issue) ->
        Keyword.put(opts, :goal_mode, true)

      true ->
        opts
    end
  end

  defp codex_goal_thread?(issue) do
    case Map.get(issue, :agent_session_id) do
      id when is_binary(id) and id != "" -> true
      _ -> false
    end
  end

  defp send_codex_update(recipient, %Issue{id: issue_id}, message)
       when is_binary(issue_id) and is_pid(recipient) do
    send(recipient, {:codex_worker_update, issue_id, message})
    :ok
  end

  defp send_codex_update(_recipient, _issue, _message), do: :ok

  defp agent_turn_opts(opts, agent_kind, codex_update_recipient, issue) do
    Keyword.merge(opts, agent_kind: agent_kind, on_message: codex_message_handler(codex_update_recipient, issue, agent_kind))
  end

  defp run_codex_turns(workspace, issue, codex_update_recipient, opts) do
    opts = Keyword.put_new(opts, :issue, issue)
    max_turns = Keyword.get(opts, :max_turns, project_max_turns(Keyword.get(opts, :project_config)))
    issue_state_fetcher = Keyword.get(opts, :issue_state_fetcher, &Tracker.fetch_issue_states_by_ids/1)

    agent_kind = Keyword.fetch!(opts, :agent_kind)
    workspace_root = Workspace.workspace_root_for(issue)

    session_opts =
      [workspace_root: workspace_root]
      |> maybe_put_codex_config(Keyword.get(opts, :project_config))
      |> maybe_put_claude_tools(agent_kind, issue)
      |> maybe_put_resume_thread_id(opts, agent_kind, issue)
      |> maybe_put_goal_mode(opts, agent_kind)

    with {:ok, session} <- CodingAgent.start_session(workspace, agent_kind, session_opts) do
      maybe_persist_goal_thread(session, issue, agent_kind, opts)

      try do
        result =
          do_run_codex_turns(
            session,
            workspace,
            issue,
            codex_update_recipient,
            opts,
            issue_state_fetcher,
            agent_kind,
            1,
            max_turns
          )

        evaluator =
          Keyword.get(opts, :publish_gate_evaluator, fn ws ->
            RunContract.evaluate_publish(RunContract.repo_states(ws), RunContract.gh_pr_checker())
          end)

        validate_evaluator =
          Keyword.get(opts, :validate_gate_evaluator, fn ws ->
            cfg = evidence_config(Keyword.get(opts, :project_config))
            Evidence.Gate.evaluate(ws, cfg, Evidence.Gate.default_deps(issue: Keyword.get(opts, :issue), config: cfg))
          end)

        turn_opts = agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)

        run_corrective_turn = fn prompt ->
          case CodingAgent.run_turn(session, prompt, issue, turn_opts) do
            {:ok, _turn_session} -> :ok
            {:error, reason} -> {:error, reason}
          end
        end

        result
        |> apply_validate_gate(workspace, validate_evaluator, run_corrective_turn, @max_corrective_turns, opts)
        |> apply_publish_gate(workspace, evaluator, run_corrective_turn, @max_corrective_turns, opts)
      after
        CodingAgent.stop_session(session, agent_kind)
      end
    end
  end

  @doc false
  @spec apply_publish_gate(
          term(),
          Path.t(),
          (Path.t() -> :satisfied | {:violations, list()}),
          (String.t() -> :ok | {:error, term()}),
          non_neg_integer()
        ) :: term()
  def apply_publish_gate(result, workspace, evaluator, run_turn, budget) do
    apply_publish_gate(result, workspace, evaluator, run_turn, budget, [])
  end

  @doc false
  @spec apply_publish_gate(
          term(),
          Path.t(),
          (Path.t() -> :satisfied | {:violations, list()}),
          (String.t() -> :ok | {:error, term()}),
          non_neg_integer(),
          keyword()
        ) :: term()
  def apply_publish_gate({:error, _reason} = error, _workspace, _evaluator, _run_turn, _budget, _opts), do: error

  # A failed validate gate already stops the run; do not mask it with publish findings.
  def apply_publish_gate({:incomplete, {:validate_gate, _violations}} = result, _workspace, _evaluator, _run_turn, _budget, _opts),
    do: result

  def apply_publish_gate(result, workspace, evaluator, run_turn, budget, opts) do
    if final_publish_allowed?(opts) do
      do_apply_publish_gate(result, workspace, evaluator, run_turn, budget)
    else
      result
    end
  end

  defp do_apply_publish_gate(result, workspace, evaluator, run_turn, budget) do
    case evaluator.(workspace) do
      :satisfied ->
        result

      {:violations, violations} when budget > 0 ->
        Logger.info("Publish gate violated; running corrective turn (remaining budget=#{budget}) violations=#{inspect(violations)}")

        case run_turn.(corrective_publish_prompt(violations, workspace)) do
          :ok -> do_apply_publish_gate(result, workspace, evaluator, run_turn, budget - 1)
          {:error, _reason} -> {:incomplete, {:publish_gate, violations}}
        end

      {:violations, violations} ->
        {:incomplete, {:publish_gate, violations}}
    end
  end

  @doc false
  @spec apply_validate_gate(
          term(),
          Path.t(),
          (Path.t() -> :satisfied | {:violations, list()}),
          (String.t() -> :ok | {:error, term()}),
          non_neg_integer()
        ) :: term()
  def apply_validate_gate(result, workspace, evaluator, run_turn, budget) do
    apply_validate_gate(result, workspace, evaluator, run_turn, budget, [])
  end

  @doc false
  @spec apply_validate_gate(
          term(),
          Path.t(),
          (Path.t() -> :satisfied | {:violations, list()}),
          (String.t() -> :ok | {:error, term()}),
          non_neg_integer(),
          keyword()
        ) :: term()
  def apply_validate_gate({:error, _reason} = error, _workspace, _evaluator, _run_turn, _budget, _opts), do: error

  def apply_validate_gate(result, workspace, evaluator, run_turn, budget, opts) do
    if final_validate_allowed?(opts) do
      do_apply_validate_gate(result, workspace, evaluator, run_turn, budget)
    else
      result
    end
  end

  defp do_apply_validate_gate(result, workspace, evaluator, run_turn, budget) do
    case evaluator.(workspace) do
      :satisfied ->
        result

      {:violations, violations} ->
        cond do
          Evidence.Gate.environment_blocked_only?(violations) ->
            Logger.info("Validate gate blocked by environment; skipping corrective turns violations=#{inspect(violations)}")

            {:incomplete, {:validate_gate, violations}}

          budget > 0 ->
            Logger.info("Validate gate violated; running corrective turn (remaining budget=#{budget}) violations=#{inspect(violations)}")

            case run_turn.(corrective_validate_prompt(violations)) do
              :ok -> do_apply_validate_gate(result, workspace, evaluator, run_turn, budget - 1)
              {:error, _reason} -> {:incomplete, {:validate_gate, violations}}
            end

          true ->
            {:incomplete, {:validate_gate, violations}}
        end
    end
  end

  defp evidence_config(%ProjectConfig{evidence: %{} = evidence}), do: evidence
  defp evidence_config(_project_config), do: %{required: false, repos: %{}}

  defp corrective_validate_prompt(violations) do
    """
    ## Validate gate failed (Symphony)

    Evidence requirements are not satisfied:

    #{Enum.map_join(violations, "\n", &validate_violation_line/1)}

    This is a **final VALIDATE** corrective turn. Only proceed if the workpad
    `### Plan` checklist is complete and `final_validate_allowed: true`;
    otherwise update the workpad and resume the next incomplete plan task
    instead.

    Read and follow the `evidence` skill now. Run **focused** checks only on files
    you changed (or backend tests that could be impacted by those changes) — do
    **not** run the full lint or unit suite; CI/CD owns full regression. For every
    repo you changed: one passing scoped `unit` run is enough — do not also record
    a failed full-suite run in the manifest. For each UI repo whose e2e is required
    (listed above), run e2e on the affected spec with screenshot/video capture.
    Before UI e2e: call **`manage_preview`** with `action: status` (or `start` / `restart` if not ready).
    Run e2e via the **project's configured e2e command** (from the `evidence` config /
    project workflow) — not bare `npx playwright test` on ad-hoc ports. The configured
    command reuses the issue's preview ports and its isolated e2e database.
    For a changed back-end/service repo that the config says may impact a UI repo
    but where you judge there is NO impact on that UI surface, declare it in the
    manifest `impact` list with `impacts_ui: false` and a concrete rationale
    instead of running its e2e. Re-run every command fresh in this session and
    write a new `.symphony/evidence/manifest.json` — do not reuse a prior manifest.
    If any prior run is marked `blocked` but the blocker is actually fixable repo
    tooling/config (a `vibe`/`.symphony` script, a wrong compose project, file
    permissions, a missing setup step), fix it and re-run instead of leaving it
    `blocked` — `blocked` is only for environment limits you cannot change from
    inside the workspace.
    Do nothing else in this turn.
    """
  end

  defp validate_violation_line(%{kind: kind, repo: repo, detail: detail}) do
    "- #{kind}#{if repo, do: " (#{repo})", else: ""}: #{detail}"
  end

  @doc false
  @spec apply_plan_gate((-> :ok | {:error, term()}), (String.t() -> :ok | {:error, term()})) :: :ok
  def apply_plan_gate(workpad_checker, run_turn) do
    case workpad_checker.() do
      :ok ->
        :ok

      {:error, _reason} ->
        _result = run_turn.(plan_gate_prompt())

        case workpad_checker.() do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Plan gate still unsatisfied after corrective turn: #{inspect(reason)}; continuing run")
            :ok
        end
    end
  end

  # The PLAN gate runs once, right after the first turn: the workpad must exist
  # before implementation continues. Softer than the publish gate — a still-missing
  # workpad logs a warning but never strands the run.
  defp run_plan_gate(session, issue, opts, agent_kind, codex_update_recipient) do
    workpad_checker = Keyword.get(opts, :workpad_checker, default_workpad_checker(issue, opts))

    turn_opts = agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)

    run_corrective_turn = fn prompt ->
      case CodingAgent.run_turn(session, prompt, issue, turn_opts) do
        {:ok, _turn_session} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end

    apply_plan_gate(workpad_checker, run_corrective_turn)
  end

  # Legacy live trackers have no project_slug; the gate no-ops there. Only a
  # genuinely missing workpad (`:not_found`) is a violation — an unresolvable
  # local project/issue means the gate has nothing to assert against.
  defp default_workpad_checker(%{project_slug: project_slug, identifier: identifier}, opts)
       when is_binary(project_slug) and is_binary(identifier) do
    fn ->
      require_execution_contract? = goal_mode?(opts)

      case Context.latest_workpad(project_slug, identifier) do
        {:error, :not_found} -> {:error, :not_found}
        {:ok, %{body: body}} -> ExecutionContract.validate_workpad(body, require_execution_contract: require_execution_contract?)
        _present_or_unresolvable -> :ok
      end
    end
  end

  defp default_workpad_checker(_issue, _opts), do: fn -> :ok end

  defp plan_gate_prompt do
    """
    ## Plan gate failed (Symphony)

    The issue is missing a valid `## Codex Workpad` execution contract. Before
    any further implementation, read and follow the `workpad` skill: create or
    update the single workpad comment with:

    - `### Plan`
    - `### Acceptance criteria`
    - `### Validation`
    - `### Outcome`

    For plan-driven runs, `### Plan` must start with execution contract metadata:
    `source_plan`, `mode`, `scope_status`, `final_validate_allowed`, and
    `final_publish_allowed`. The same `### Plan` section must track every plan
    task with `[ ]`, `[~]`, or `[x]` before implementation continues.

    Do nothing else in this turn.
    """
  end

  defp corrective_publish_prompt(violations, workspace) do
    """
    ## Publish gate failed (Symphony)

    The run cannot finish because the following deliverables are missing:

    #{Enum.map_join(violations, "\n", fn v -> "- #{v.repo}: #{v.detail}" end)}

    Current deliverable state:

    #{RunContract.summary_text(RunContract.repo_states(workspace))}

    Follow the `push` skill now: commit any intentional pending changes, push each
    branch with upstream tracking, and open a pull request for every repo with
    commits. Do nothing else in this turn.
    """
  end

  # The turn loop carries session, issue, and injected test dependencies explicitly.
  # credo:disable-for-next-line Credo.Check.Refactor.FunctionArity
  defp do_run_codex_turns(
         app_session,
         workspace,
         issue,
         codex_update_recipient,
         opts,
         issue_state_fetcher,
         agent_kind,
         turn_number,
         max_turns
       ) do
    prompt = build_turn_prompt(issue, opts, workspace, turn_number, max_turns)

    with {:ok, turn_session} <-
           CodingAgent.run_turn(
             app_session,
             prompt,
             issue,
             agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)
           ) do
      Logger.info("Completed agent run for #{issue_context(issue)} session_id=#{turn_session[:session_id]} workspace=#{workspace} turn=#{turn_number}/#{max_turns}")

      advanced_session = maybe_advance_session(app_session, turn_session)

      if turn_number == 1 do
        run_plan_gate(advanced_session, issue, opts, agent_kind, codex_update_recipient)
      end

      case continue_with_issue?(issue, issue_state_fetcher, Keyword.get(opts, :project_config), opts) do
        {:continue, refreshed_issue} ->
          continue_or_stop_outer_turn_loop(
            advanced_session,
            workspace,
            refreshed_issue,
            codex_update_recipient,
            opts,
            issue_state_fetcher,
            agent_kind,
            turn_number,
            max_turns
          )

        {:done, _refreshed_issue} ->
          :completed

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp continue_or_stop_outer_turn_loop(
         app_session,
         workspace,
         refreshed_issue,
         codex_update_recipient,
         opts,
         issue_state_fetcher,
         agent_kind,
         turn_number,
         max_turns
       ) do
    handoff_outcome = handoff_ready_outcome(workspace, opts)

    cond do
      goal_mode?(opts) and not scope_incomplete?(opts) ->
        Logger.info("Stopping outer agent turn loop for #{issue_context(refreshed_issue)} because Codex goal mode handles continuation internally")

        :completed

      match?({:stop, _outcome}, handoff_outcome) ->
        {:stop, outcome} = handoff_outcome

        Logger.info("Stopping outer agent turn loop for #{issue_context(refreshed_issue)} after turn #{turn_number}/#{max_turns}; deliverables ready outcome=#{inspect(outcome)}")

        outcome

      turn_number < max_turns ->
        Logger.info("Continuing agent run for #{issue_context(refreshed_issue)} after normal turn completion turn=#{turn_number}/#{max_turns}")

        pause_between_turns(opts)

        do_run_codex_turns(
          app_session,
          workspace,
          refreshed_issue,
          codex_update_recipient,
          opts,
          issue_state_fetcher,
          agent_kind,
          turn_number + 1,
          max_turns
        )

      true ->
        Logger.info("Reached agent.max_turns for #{issue_context(refreshed_issue)} with issue still active; returning control to orchestrator")

        {:incomplete, :max_turns}
    end
  end

  # When publish deliverables are already satisfied (clean trees, nothing to push),
  # further continuation turns cannot advance implementation — only VALIDATE/evidence
  # work remains. Stop the outer loop once the validate gate is satisfied or only
  # reports environment blockers, so the agent does not burn max_turns re-checking
  # an unchanged manifest.
  @doc false
  @spec handoff_ready_outcome(Path.t(), keyword()) :: :continue | {:stop, run_outcome()}
  def handoff_ready_outcome(workspace, opts) do
    # `:handoff_ready_evaluator` is a test seam (mirroring `:validate_gate_evaluator`
    # and `:publish_gate_evaluator`): production never sets it, so the default logic
    # below is what actually runs. It lets continuation tests drive the outer loop
    # without standing up a dirty git tree just to keep the loop alive.
    case Keyword.get(opts, :handoff_ready_evaluator) do
      fun when is_function(fun, 2) -> fun.(workspace, opts)
      fun when is_function(fun, 1) -> fun.(workspace)
      nil -> default_handoff_ready_outcome(workspace, opts)
    end
  end

  defp default_handoff_ready_outcome(workspace, opts) do
    repo_states = RunContract.repo_states(workspace)

    cond do
      RunContract.work_present?(repo_states) ->
        :continue

      scope_incomplete?(opts) ->
        :continue

      true ->
        validate_gate_outcome(workspace, opts)
    end
  end

  defp validate_gate_outcome(workspace, opts) do
    evaluator =
      Keyword.get(opts, :validate_gate_evaluator, fn ws ->
        cfg = evidence_config(Keyword.get(opts, :project_config))
        Evidence.Gate.evaluate(ws, cfg, Evidence.Gate.default_deps(issue: Keyword.get(opts, :issue), config: cfg))
      end)

    case evaluator.(workspace) do
      :satisfied ->
        {:stop, :completed}

      {:violations, violations} ->
        if Evidence.Gate.environment_blocked_only?(violations) do
          {:stop, {:incomplete, {:validate_gate, violations}}}
        else
          :continue
        end
    end
  end

  defp final_validate_allowed?(opts) do
    case execution_contract_from_opts(opts) do
      %ExecutionContract{final_validate_allowed?: allowed?} -> allowed?
      {:error, _reason} -> false
      :absent -> true
      nil -> true
    end
  end

  defp final_publish_allowed?(opts) do
    case execution_contract_from_opts(opts) do
      %ExecutionContract{final_publish_allowed?: allowed?} -> allowed?
      {:error, _reason} -> false
      :absent -> true
      nil -> true
    end
  end

  defp scope_incomplete?(opts) do
    case execution_contract_from_opts(opts) do
      %ExecutionContract{scope_complete?: complete?} -> not complete?
      {:error, _reason} -> true
      _absent_or_unplanned -> false
    end
  end

  defp execution_contract_from_opts(opts) do
    case Keyword.fetch(opts, :execution_contract) do
      {:ok, contract} ->
        contract

      :error ->
        execution_contract_from_fetcher(opts)
    end
  end

  defp execution_contract_from_fetcher(opts) do
    case Keyword.get(opts, :execution_contract_fetcher) do
      fun when is_function(fun, 0) -> normalize_execution_contract(fun.())
      fun when is_function(fun, 1) -> normalize_execution_contract(fun.(Keyword.get(opts, :issue)))
      _other -> latest_workpad_execution_contract(Keyword.get(opts, :issue))
    end
  end

  defp latest_workpad_execution_contract(%{project_slug: project_slug, identifier: identifier})
       when is_binary(project_slug) and is_binary(identifier) do
    case Context.latest_workpad(project_slug, identifier) do
      {:ok, %{body: body}} -> normalize_execution_contract(ExecutionContract.parse(body))
      {:error, :not_found} -> :absent
      _unresolvable -> :absent
    end
  end

  defp latest_workpad_execution_contract(_issue), do: :absent

  defp normalize_execution_contract({:ok, %ExecutionContract{} = contract}), do: contract
  defp normalize_execution_contract(%ExecutionContract{} = contract), do: contract
  defp normalize_execution_contract(:absent), do: :absent
  defp normalize_execution_contract({:error, reason}), do: {:error, reason}
  defp normalize_execution_contract(_other), do: :absent

  defp build_turn_prompt(issue, opts, workspace, 1, _max_turns) do
    base = PromptBuilder.build_prompt(issue, Keyword.put(opts, :workspace, workspace))
    repo_states = RunContract.repo_states(workspace)

    if RunContract.work_present?(repo_states) do
      base <> "\n\n" <> resume_section(repo_states)
    else
      base
    end
  end

  defp build_turn_prompt(_issue, opts, workspace, turn_number, max_turns) do
    continuation_prompt(turn_number, max_turns, RunContract.repo_states(workspace), opts)
  end

  @doc false
  @spec resume_section([RunContract.RepoState.t()]) :: String.t()
  def resume_section(repo_states) do
    """
    ## Resume notice (Symphony)

    A previous run already worked in this workspace. Current deliverable state:

    #{RunContract.summary_text(repo_states)}

    Do NOT restart from scratch. Resume in this order:

    1. Finish remaining ticket work (implementation, commits, push, PR) — follow the
       `push` skill if publishing is missing.
    2. Run VALIDATE/evidence only when the change set is ready for handoff — not before
       deliverables above are in place.

    Workpad validation notes from earlier runs are context, not the first action item.
    """
  end

  @doc false
  @spec continuation_prompt(pos_integer(), pos_integer(), [RunContract.RepoState.t()]) :: String.t()
  def continuation_prompt(turn_number, max_turns, repo_states) do
    continuation_prompt(turn_number, max_turns, repo_states, [])
  end

  @doc false
  @spec continuation_prompt(pos_integer(), pos_integer(), [RunContract.RepoState.t()], keyword()) :: String.t()
  def continuation_prompt(turn_number, max_turns, repo_states, opts) do
    """
    Continuation guidance:

    - The previous turn completed normally, but the issue is still in an active state.
    - This is continuation turn ##{turn_number} of #{max_turns} for the current agent run.
    - Resume from the current workspace and workpad state instead of restarting from scratch.
    - The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.
    - Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.
    - Do not front-load the full VALIDATE/evidence matrix while implementation or PR work is still missing.
    - When deliverables below show no commits ahead and no uncommitted changes, you are in **VALIDATE-only** mode: read and follow the `evidence` skill now. Run focused tests from the git diff and write a fresh `.symphony/evidence/manifest.json` for this session. Updating the workpad alone is not progress.
    - On continuation turns, do **not** loop on `git status` + manifest parse + "Continuação #N" workpad notes. Either execute missing evidence commands or end the turn if this session already recorded the outcome (including `blocked` after a real retry).
    - If rework asked for fresh evidence, delete the old manifest and artifacts before re-running checks.
    - If a prior manifest marks runs as `blocked`, retry each required command **once** in this turn before recording `blocked` again. After one retry still blocked, stop — document in Validation and end the turn.
    - A plan task is not complete until its `### Plan` item has terminal validation/evidence/commit metadata: validation `passed` or `n/a`, evidence `done` or `n/a`, and commit `done` or `n/a`. Tests passing alone do not make `evidence: done`.

    Deliverable state (computed by the orchestrator from the workspace):

    #{RunContract.summary_text(repo_states)}

    #{next_incomplete_task_section(opts)}

    Any repo with commits ahead must end with a pushed branch and an open pull request (follow the `push` skill). Run the `evidence` skill only when handoff is ready.
    """
  end

  defp next_incomplete_task_section(opts) do
    case execution_contract_from_opts(opts) do
      %ExecutionContract{next_incomplete: %{title: title, remaining: remaining}} when is_binary(title) ->
        remaining_text =
          case remaining do
            [] -> ""
            items -> "\n    Remaining:\n" <> Enum.map_join(items, "\n", &"    - #{&1}")
          end

        "Next incomplete plan task: #{title}#{remaining_text}\n"

      _contract ->
        ""
    end
  end

  defp continue_with_issue?(%Issue{id: issue_id} = issue, issue_state_fetcher, project_config, opts)
       when is_binary(issue_id) do
    case issue_state_fetcher.([issue_id]) do
      {:ok, [%Issue{} = refreshed_issue | _]} ->
        cond do
          wait_state?(refreshed_issue.state, project_config) ->
            {:done, refreshed_issue}

          open_pr_should_stop_turns?(refreshed_issue, project_config, opts) ->
            Logger.info("Stopping agent turns for #{issue_context(refreshed_issue)}: open pull request while still in In Progress")

            {:done, refreshed_issue}

          active_issue_state?(refreshed_issue.state, project_config) ->
            {:continue, refreshed_issue}

          true ->
            {:done, refreshed_issue}
        end

      {:ok, []} ->
        {:done, issue}

      {:error, reason} ->
        {:error, {:issue_state_refresh_failed, reason}}
    end
  end

  defp continue_with_issue?(issue, _issue_state_fetcher, _project_config, _opts), do: {:done, issue}

  defp pause_between_turns(opts) do
    case Keyword.get(opts, :continuation_delay_ms, @continuation_delay_ms) do
      ms when is_integer(ms) and ms > 0 -> Process.sleep(ms)
      _ -> :ok
    end
  end

  defp goal_mode?(opts) do
    Keyword.get(opts, :goal_mode, false) == true or
      case Keyword.get(opts, :goal) do
        goal when is_binary(goal) -> String.trim(goal) != ""
        _goal -> false
      end
  end

  defp wait_state?(state_name, project_config) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    project_config
    |> wait_states_for()
    |> Enum.any?(fn wait_state -> normalize_issue_state(wait_state) == normalized_state end)
  end

  defp wait_state?(_state_name, _project_config), do: false

  @doc false
  @spec open_pr_should_stop_turns?(Issue.t(), ProjectConfig.t() | nil, keyword()) :: boolean()
  def open_pr_should_stop_turns?(%Issue{state: state, identifier: identifier}, project_config, opts)
      when is_binary(state) and is_binary(identifier) do
    not scope_incomplete?(opts) and
      project_tracker_kind(project_config) == "github" and
      normalize_issue_state(state) == "in progress" and
      github_issue_has_open_pull_request?(identifier)
  end

  def open_pr_should_stop_turns?(_issue, _project_config, _opts), do: false

  # Thread the project's `codex:` section (from DB workflow_markdown) over instance
  # defaults so dispatch honors per-project command/approval/sandbox settings.
  defp maybe_put_codex_config(opts, %ProjectConfig{codex: project_codex}) when is_map(project_codex) do
    Keyword.put(opts, :codex_config, InstanceConfig.merge_codex_section(project_codex))
  end

  defp maybe_put_codex_config(opts, _project_config) do
    Keyword.put(opts, :codex_config, InstanceConfig.codex_section())
  end

  # Codex defaults its dynamic tools internally (see Codex.CodingAgent.start_session/2 →
  # thread/start → dynamicTools: DynamicTool.coding_agent_tool_specs()).  The native
  # Claude and Cursor adapters take them via session opts, so we inject them here to
  # preserve spec §3.4 parity (set_issue_status / github_graphql / linear_graphql
  # available in execution runs regardless of which adapter is active).
  @doc false
  @spec claude_session_opts(keyword(), String.t(), map()) :: keyword()
  def claude_session_opts(session_opts, agent_kind, issue) do
    maybe_put_claude_tools(session_opts, agent_kind, issue)
  end

  defp maybe_put_claude_tools(session_opts, agent_kind, issue) when agent_kind in ["claude", "cursor"] do
    session_opts
    |> Keyword.put(:dynamic_tools, DynamicTool.coding_agent_tool_specs())
    |> Keyword.put(:tool_executor, fn tool, arguments ->
      DynamicTool.execute(tool, arguments, issue: issue)
    end)
  end

  defp maybe_put_claude_tools(session_opts, _agent_kind, _issue), do: session_opts

  # Goal-mode Codex runs resume the issue's durable thread so the native goal
  # state persists across orchestrator dispatches. The workspace sidecar is the
  # primary source; the issue's stored `agent_session_id` is a belt-and-suspenders
  # pointer that survives even when the workspace is recreated.
  defp maybe_put_resume_thread_id(session_opts, opts, "codex", issue) do
    if goal_mode?(opts) do
      case issue_session_thread_id(issue) do
        thread_id when is_binary(thread_id) and thread_id != "" ->
          Keyword.put(session_opts, :resume_thread_id, thread_id)

        _ ->
          session_opts
      end
    else
      session_opts
    end
  end

  defp maybe_put_resume_thread_id(session_opts, _opts, _agent_kind, _issue), do: session_opts

  # Propagate goal mode into the session so `CodingAgent` resumes the durable
  # Codex thread (via `resume_thread_id`/sidecar) instead of starting a fresh
  # one. Without this flag the session would ignore the resume pointer and lose
  # the native goal state across dispatches.
  defp maybe_put_goal_mode(session_opts, opts, "codex") do
    if goal_mode?(opts) do
      Keyword.put(session_opts, :goal_mode, true)
    else
      session_opts
    end
  end

  defp maybe_put_goal_mode(session_opts, _opts, _agent_kind), do: session_opts

  defp issue_session_thread_id(%Issue{agent_session_id: id}) when is_binary(id) and id != "", do: id
  defp issue_session_thread_id(_issue), do: nil

  # Persist the durable Codex thread id at the issue level for goal-mode runs so
  # the tracker can show that a goal thread exists (even when no worker is live)
  # and so future dispatches can resume it. Best-effort: trackers without a local
  # row (e.g. GitHub/Jira) simply skip persistence.
  defp maybe_persist_goal_thread(session, %Issue{} = issue, "codex", opts) do
    with true <- goal_mode?(opts),
         thread_id when is_binary(thread_id) and thread_id != "" <- Map.get(session, :thread_id),
         slug when is_binary(slug) and slug != "" <- issue.project_slug,
         identifier when is_binary(identifier) and identifier != "" <- issue.identifier,
         true <- thread_id != issue.agent_session_id do
      persist_agent_session_id(slug, identifier, thread_id)
    else
      _ -> :ok
    end
  end

  defp maybe_persist_goal_thread(_session, _issue, _agent_kind, _opts), do: :ok

  defp persist_agent_session_id(slug, identifier, thread_id) do
    Context.set_agent_session_id(slug, identifier, thread_id)
    :ok
  rescue
    error ->
      Logger.debug("Skipping agent_session_id persistence identifier=#{identifier} reason=#{inspect(error)}")
      :ok
  end

  defp project_max_turns(%ProjectConfig{max_turns: n}) when is_integer(n) and n > 0, do: n
  defp project_max_turns(_project_config), do: Config.agent_max_turns()

  defp active_states_for(%ProjectConfig{active_states: states}) when is_list(states), do: states
  defp active_states_for(_project_config), do: Config.active_states()

  defp wait_states_for(%ProjectConfig{wait_states: states}) when is_list(states), do: states
  defp wait_states_for(_project_config), do: Config.wait_states()

  defp project_tracker_kind(%ProjectConfig{tracker_kind: kind}) when is_binary(kind), do: kind
  defp project_tracker_kind(_project_config), do: Config.tracker_kind()

  defp github_issue_has_open_pull_request?(identifier) do
    key = {:issue_open_pr, SymphonyElixir.GitHub.Config.repo(), identifier}

    result =
      ReadCache.fetch(key, fn -> GitHubClient.issue_has_open_pull_request?(identifier) end, @open_pr_cache_ttl_ms)

    case result do
      {:ok, true} -> true
      _ -> false
    end
  end

  defp active_issue_state?(state_name, project_config) when is_binary(state_name) do
    normalized_state = normalize_issue_state(state_name)

    project_config
    |> active_states_for()
    |> Enum.any?(fn active_state -> normalize_issue_state(active_state) == normalized_state end)
  end

  defp active_issue_state?(_state_name, _project_config), do: false

  defp normalize_issue_state(state_name) when is_binary(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
  end

  defp issue_context(%Issue{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp maybe_advance_session(session, %{cli_session_id: cli_session_id}) when is_binary(cli_session_id) do
    Map.put(session, :cli_session_id, cli_session_id)
  end

  defp maybe_advance_session(session, _result), do: session
end
