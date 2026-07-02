defmodule SymphonyElixir.PromptBuilder do
  @moduledoc """
  Builds agent prompts from issue data.
  """

  alias SymphonyElixir.DevServer
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.{ProjectConfig, Repo, Skills}
  alias SymphonyElixir.Workpad.UnifiedUnitPlan

  @render_opts [strict_filters: true]
  @artifact_max_bytes 512_000
  @max_artifacts 20
  @max_artifact_section_bytes 1_000_000
  @artifact_separator "\n\n"
  @artifact_too_large_message "_Skipped: artifact too large._"
  @artifact_unreadable_message "_Skipped: artifact could not be read._"

  @spec build_prompt(SymphonyElixir.Issue.t(), keyword()) :: String.t()
  def build_prompt(issue, opts \\ []) do
    config = resolve_config!(issue)

    rendered =
      config.prompt_template
      |> parse_template!()
      |> Solid.render!(
        %{
          "attempt" => Keyword.get(opts, :attempt),
          "issue" => issue |> Map.from_struct() |> to_solid_map()
        },
        @render_opts
      )
      |> IO.iodata_to_binary()
      |> ensure_utf8()

    rendered <>
      execution_methodology_section() <>
      workpad_bootstrap_section() <>
      workflow_guidance_section(issue, Keyword.get(opts, :agent_kind)) <>
      bundle_section(opts) <>
      child_unit_section(
        Keyword.get(opts, :bundle_unit),
        Keyword.get(opts, :parent_identifier),
        Keyword.get(opts, :shared_contracts, [])
      ) <>
      child_constraints_section(Keyword.get(opts, :parent_identifier)) <>
      validate_section(config) <>
      preview_context_section(issue) <>
      discussion_section(issue) <>
      artifacts_section(Keyword.get(opts, :workspace))
  end

  @doc """
  Parent coordinator section. When a run carries a parsed execution `bundle`, the
  parent acts as a coordinator: it executes `workpad_task` units inline and
  dispatches one child run per `child_run` unit. Returns "" for non-bundle runs.
  """
  @spec bundle_coordinator_section(SymphonyElixir.Workpad.ExecutionBundle.t() | nil) :: String.t()
  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity, Credo.Check.Refactor.Nesting
  def bundle_coordinator_section(%SymphonyElixir.Workpad.ExecutionBundle{units: units} = bundle)
      when is_list(units) and units != [] do
    unit_lines =
      Enum.map_join(units, "\n", fn unit ->
        deps = if unit.depends_on == [], do: "", else: " — depends on: #{Enum.join(unit.depends_on, ", ")}"
        consumes = if unit.consumes == [], do: "", else: " — consumes: #{Enum.join(unit.consumes, ", ")}"
        produces = if unit.produces == [], do: "", else: " — produces: #{Enum.join(unit.produces, ", ")}"
        repo = if is_binary(unit.repo), do: " [#{unit.repo}]", else: ""
        "- **#{unit.id}** (#{unit.type})#{repo}#{produces}#{consumes}#{deps}"
      end)

    contract_lines =
      case bundle.shared_contracts do
        [] ->
          ""

        contracts ->
          lines =
            Enum.map_join(contracts, "\n", fn contract ->
              consumers = if contract.consumers == [], do: "", else: " → #{Enum.join(contract.consumers, ", ")}"
              "- **#{contract.id}** (#{contract.kind || "contract"}, status: #{contract.status}) owned by #{contract.owner_unit}#{consumers}"
            end)

          "\n\nShared contracts:\n#{lines}"
      end

    """

    ## Execution bundle (coordinator)

    You are the **coordinator** for this parent task. The plan below is authoritative — do not re-derive it.

    Units:
    #{unit_lines}#{contract_lines}

    Rules:
    - Execute every `workpad_task` unit yourself, inline, in this workspace. You MAY spawn native subagents for independent slices of a `workpad_task`.
    - **Do not implement `child_run` units yourself.** Each `child_run` is dispatched as its own run in an isolated worktree + branch and opens a PR **against the per-repo parent integration branch** `symphony/<this-parent>/<repo>`.
    - A unit that `consumes` a shared contract must wait until that contract is `ready`. As the owner, produce the contract first and call `update_shared_contract` to mark it `ready` so consumers unblock.
    - **Dependency cadence**: a `child_run` releases only once the units it `depends_on` reach human review (their PR is open). When a dependent starts, its worktree is branched off its **predecessor's branch** (a same-repo dependency), so the predecessor's work is already present as its starting reference — the dependent still opens its own PR into `symphony/<this-parent>/<repo>`.
    - Coordinate cadence with `query_bundle_status` (see which units are live/waiting/done and what blocks each). Children report progress to your workpad via `report_unit_status` — read it instead of polling them.
    - **Integration is yours**: once a `child_run`'s PR is green, merge it into `symphony/<this-parent>/<repo>`. When every unit for a repo is merged, open exactly **one** final PR per repo (`symphony/<this-parent>/<repo>` → that repo's default branch).
    - The parent only completes once every `workpad_task` is done AND every `child_run` has been integrated (its PR merged into the integration branch, and the final per-repo PR opened).
    """
  end

  def bundle_coordinator_section(_bundle), do: ""

  defp bundle_section(opts) do
    case Keyword.get(opts, :unit_plan) do
      %UnifiedUnitPlan{} = plan ->
        unified_parent_section(Keyword.get(opts, :bundle), plan, opts)

      _ ->
        bundle_coordinator_section(Keyword.get(opts, :bundle))
    end
  end

  @doc """
  Unified parent section when `lab.bundle_child_orchestration` is off. The parent
  runs one session and sequences native subagents per unit — no orchestrator child
  dispatches, no integration branches, one PR per repo.
  """
  @spec unified_parent_section(
          SymphonyElixir.Workpad.ExecutionBundle.t() | nil,
          UnifiedUnitPlan.t(),
          keyword()
        ) :: String.t()
  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity, Credo.Check.Refactor.Nesting
  def unified_parent_section(%SymphonyElixir.Workpad.ExecutionBundle{units: units} = bundle, %UnifiedUnitPlan{} = plan, opts)
      when is_list(units) and units != [] do
    feature_branch = Keyword.get(opts, :feature_branch, "feat/<parent>")

    unit_lines =
      plan.units
      |> Enum.map_join("\n", fn unit ->
        flags =
          [
            if(unit.ad_hoc, do: "ad-hoc", else: nil),
            if(unit.eligible, do: nil, else: "skipped: #{unit.skip_reason}"),
            if(is_binary(unit.board_status), do: "board: #{unit.board_status}", else: nil)
          ]
          |> Enum.reject(&is_nil/1)
          |> Enum.join(" · ")

        deps = if unit.depends_on == [], do: "", else: " — depends on: #{Enum.join(unit.depends_on, ", ")}"
        consumes = if unit.consumes == [], do: "", else: " — consumes: #{Enum.join(unit.consumes, ", ")}"
        produces = if unit.produces == [], do: "", else: " — produces: #{Enum.join(unit.produces, ", ")}"
        repo = if is_binary(unit.repo), do: " [#{unit.repo}]", else: ""
        suffix = if flags == "", do: "", else: " (#{flags})"
        "- **#{unit.issue}**#{repo}#{produces}#{consumes}#{deps}#{suffix}"
      end)

    contract_lines =
      case bundle.shared_contracts do
        [] ->
          ""

        contracts ->
          lines =
            Enum.map_join(contracts, "\n", fn contract ->
              consumers = if contract.consumers == [], do: "", else: " → #{Enum.join(contract.consumers, ", ")}"
              "- **#{contract.id}** (#{contract.kind || "contract"}, status: #{contract.status}) owned by #{contract.owner_unit}#{consumers}"
            end)

          "\n\nShared contracts:\n#{lines}"
      end

    warnings =
      case plan.warnings do
        [] -> ""
        list -> "\n\nPlan warnings:\n" <> Enum.map_join(list, "\n", &"- #{&1}")
      end

    """

    ## Unified parent execution (default mode)

    You are the **single parent implementer** for this task. Run **native subagents**
    (`subagent-driven-development`) — one subagent per eligible unit below. The
    orchestrator does **not** dispatch separate runs for `child_run` units.

    Unit plan (board + bundle):
    #{unit_lines}#{contract_lines}#{warnings}

    Rules:
    - Read `subtask-orchestration` for bundle/contract semantics; execution is in-session only.
    - Sequence units by dependency order. Before starting unit B, confirm predecessors
      reached **Human Review** or a terminal state via `query_bundle_status` and board status.
    - Each subagent scope: **one sub-issue**, move **that** issue on the board (In Progress → Human Review),
      run scoped tests, write evidence with `task_id` = sub-issue identifier, call `report_unit_status`.
    - **Git:** one feature branch per repo: `#{feature_branch}`. All units commit to the same branch — no
      `feat/MAC-*` child branches, **no** integration branch (`symphony/<parent>/<repo>`).
    - **PRs:** when all units are done, open exactly **one PR per touched repo** (`#{feature_branch}` → default).
    - Producers call `update_shared_contract` when validation passes.
    - Parent dispatch must **not** drag Human Review / terminal children on the board.
    """
  end

  def unified_parent_section(_bundle, _plan, _opts), do: ""

  @doc """
  Child-scoped section for a single `child_run` unit. Scopes the agent to its
  unit, the shared contracts it touches, and a back-link to the parent.
  Returns "" when there is no unit context.
  """
  @spec child_unit_section(map() | nil, String.t() | nil, [map()]) :: String.t()
  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  def child_unit_section(unit, parent_identifier, shared_contracts)
      when is_map(unit) do
    repo = if is_binary(unit[:repo]), do: " in `#{unit[:repo]}`", else: ""
    produces = if (unit[:produces] || []) == [], do: "", else: "\n- You **produce** shared contract(s): #{Enum.join(unit[:produces], ", ")}"
    consumes = if (unit[:consumes] || []) == [], do: "", else: "\n- You **consume** shared contract(s): #{Enum.join(unit[:consumes], ", ")} (treat them as fixed inputs)"

    parent_line =
      if is_binary(parent_identifier),
        do: "\n- Parent task: **#{parent_identifier}** (this run is one unit of its execution bundle).",
        else: ""

    depends_line =
      case unit[:depends_on] || [] do
        [] ->
          ""

        deps ->
          "\n- You **depend on**: #{Enum.join(deps, ", ")}. Your worktree is already **branched** off your predecessor's branch, so its committed work is your starting point — build on top of it, do NOT re-implement it. Your PR still targets the parent integration branch (never the predecessor branch)."
      end

    relevant =
      Enum.filter(shared_contracts, fn contract ->
        contract.id in (unit[:produces] || []) or contract.id in (unit[:consumes] || [])
      end)

    contract_block =
      case relevant do
        [] ->
          ""

        contracts ->
          lines =
            Enum.map_join(contracts, "\n", fn contract ->
              "- **#{contract.id}** (status: #{contract.status}) owned by #{contract[:owner_unit]}"
            end)

          "\n\nRelevant shared contracts:\n#{lines}"
      end

    """

    ## Child run scope (unit `#{unit[:id]}`)

    This run delivers a **single unit**#{repo} of a larger parent task. Stay strictly within this unit's scope and open exactly **one focused PR** for it, targeting the parent integration branch, then hand off.#{parent_line}#{depends_line}#{produces}#{consumes}#{contract_block}

    - Call `report_unit_status` at each phase transition (started, contract_ready, pr_open, blocked, done) so the coordinator can sequence siblings without polling you.
    - If you produce a shared contract, call `update_shared_contract` to mark it `ready` the moment its shape is stable.
    - You MAY use native subagents for independent slices of this unit, but keep everything within this one worktree/branch/PR.
    """
  end

  def child_unit_section(_unit, _parent_identifier, _shared_contracts), do: ""

  @doc """
  Hard execution constraints for a `child_run` unit. The child opens exactly one
  focused PR for its unit and then STOPS — it must never babysit CI (the
  sleep/poll/rerun loop that ballooned cached input tokens). CI and integration
  belong to the parent. Returns "" for non-child runs (no parent identifier).
  """
  @spec child_constraints_section(String.t() | nil) :: String.t()
  def child_constraints_section(parent_identifier) when is_binary(parent_identifier) do
    """

    ## Child unit execution constraints (Symphony)

    This run is a **bundle child unit** of parent task **#{parent_identifier}**. Stay strictly inside your unit's scope and hand off cleanly:

    - Implement only your unit (TDD), commit to your unit branch, and open exactly **one focused pull request** for it.
    - **Your PR targets the parent integration branch** `symphony/#{parent_identifier}/<repo>` (Symphony sets the base automatically when it publishes; if you open the PR by hand, pass `--base symphony/#{parent_identifier}/<repo>`). Never target the repo's default branch — the parent owns the final per-repo PR.
    - **Same-repo as the parent?** Reuse the parent's already-installed dependencies and preview — do **not** re-clone, re-install, or re-provision a preview. Still write and run this unit's own tests and capture its own evidence.
    - Capture per-subtask **evidence** (tests + artifacts) for your unit before handing off, exactly as a standalone task would.
    - Report progress with `report_unit_status` (phase + summary + blockers/contracts_ready/pr_url) so the coordinator can sequence siblings. Use `query_bundle_status` to see whether your dependencies are ready instead of polling.
    - **After opening (or finding) your unit's PR, STOP.** Do **not** babysit CI: do **not** run `gh run rerun`, `gh run cancel`, or `gh pr`/`gh run` status-watch loops, and do **not** `sleep` or otherwise wait on checks, builds, or deploys.
    - CI results and integration are the **parent task's** responsibility — the parent merges your PR into the integration branch and opens the final per-repo PR. End your turn once your PR is open and `report_unit_status` records the handoff.
    - If your unit is blocked by a dependency or shared contract, record it via `report_unit_status` and end the turn — do not spin.
    """
  end

  def child_constraints_section(_parent_identifier), do: ""

  # Codex receives the long-running objective as a native goal (set on the
  # thread by the orchestrator), so it is not duplicated here. Claude and Cursor
  # have no native goal primitive, so the workflow objective is injected into the
  # prompt and they rely on the agent runner's multi-turn loop for continuation.
  defp workflow_guidance_section(%SymphonyElixir.Issue{agent_goal: goal}, agent_kind)
       when agent_kind in ["claude", "cursor"] and is_binary(goal) do
    case String.trim(goal) do
      "" ->
        ""

      trimmed ->
        """

        ## Long-running workflow

        Treat this issue as a long-running workflow: keep iterating across turns until the objective below is met or you are genuinely blocked. Do not end the run while the issue is still active and work remains.

        #{trimmed}
        """
    end
  end

  defp workflow_guidance_section(_issue, _agent_kind), do: ""

  # The workpad must exist before any code — and its scope must come from the
  # context Symphony already injected (authoring spec/plan first, then the issue
  # description), never from a GitHub lookup (which previously fetched a
  # same-numbered issue in the wrong repo and left the agent without scope). The
  # self-correction note stops the "no scope, no-op" spinning we saw on GAM-4018.
  # Runs on the first turn only (build_prompt is turn 1).
  defp workpad_bootstrap_section do
    """

    ## Workpad first (Symphony)

    Before writing any code, create the single `## Codex Workpad` comment for this
    issue (follow the `workpad` skill), then derive its `### Plan` and
    `### Acceptance criteria` from the scope Symphony already gave you here:

    - When authoring artifacts (a spec or plan under `docs/superpowers/`) appear
      below, derive the Plan from those — they are the source of truth for scope.
    - Otherwise derive the Plan and Acceptance criteria from the issue title and
      description above.
    - Do not fetch the issue from GitHub to discover scope, and do not look up a
      same-numbered issue in another repository — the canonical scope is embedded above.
    - Use the issue-bound comment tools (`add_comment` / `list_comments` /
      `update_comment`); keep exactly one workpad and edit it in place.

    Self-correct instead of stalling: if you conclude there is "no scope", "no
    issue description", or "no plan artifact", you are looking in the wrong place
    (such as a GitHub lookup), not facing missing scope. Re-read the spec/plan and
    issue description in this prompt and build the Plan from them — never burn turns
    spinning on missing scope or record a no-op for it.
    """
  end

  # Orchestrator dispatches are execution runs — not issue authoring. Inject the
  # vendored subagent-driven-development skill (same pattern as complex-mode
  # authoring in Assistant.CodexSession) and tell the agent to skip design-first
  # skills that are already satisfied by injected spec/plan artifacts.
  @doc false
  @spec execution_methodology_section() :: String.t()
  def execution_methodology_section do
    case Skills.load(["subagent-driven-development"]) do
      "" ->
        ""

      skill_body ->
        """

        ## Symphony execution mode (orchestrator dispatch)

        This is an **execution** run dispatched by Symphony — not issue authoring.
        Design/spec work is already done (see authoring artifacts below when present).

        - Do **NOT** use `brainstorming`, `writing-plans`, or `using-superpowers`.
        - Do **NOT** restart design-first discovery or ask for spec approval.
        - Follow the vendored execution methodology below exactly.
        - When `docs/superpowers/plans/` artifacts appear below, treat them as the implementation plan.

        #{skill_body}
        """
    end
  end

  # Pre-fills the VALIDATE/evidence guidance from the project's own `evidence:`
  # config (repos, scoped unit/e2e commands, UI paths) so every dispatched prompt
  # carries project-specific validation instructions instead of a hand-copied,
  # tool-specific template. Renders nothing when the project declares no evidence
  # repos.
  @doc false
  @spec validate_section(ProjectConfig.t()) :: String.t()
  def validate_section(%ProjectConfig{evidence: evidence}) do
    case evidence_repo_lines(evidence) do
      [] ->
        ""

      repo_lines ->
        """

        ## VALIDATE — evidence gate (follow the `evidence` skill)

        Before handoff, prove what you changed and write `.symphony/evidence/manifest.json` at the **workspace root** (not inside the git clone). Scope checks to the diff (`git diff --name-only origin/<integration-branch>...HEAD` per repo) — CI owns full regression.

        Per-repo commands (from this project's `evidence` config):
        #{Enum.join(repo_lines, "\n")}

        When a UI repo's paths change, run its **configured** e2e command above with screenshot + video — never bare `npx playwright test` on ad-hoc ports. Call `manage_preview` (`status`/`start`) first. Preview is best-effort and non-blocking: if it won't reach `ready`, still write the e2e tests, run the unit suite, record the blocker in your workpad, and proceed (CI can run UI e2e) — do not stall on a stuck preview.

        Manifest: one passing `unit` run per changed repo; for a changed UI repo, a passing `e2e` run with at least 1 screenshot and 1 video. Record only commands you ran this session, then end the turn — do not move the card.

        As you prove each acceptance criterion, tick it in the issue body with `update_acceptance_criteria` (read with no args, then mark by `index` or `text`). It edits only the `## Acceptance criteria` checkboxes — never use `update_issue`/`gh issue edit` for this. Leave a box unchecked if the criterion is not yet demonstrated.
        """
    end
  end

  def validate_section(_config), do: ""

  defp evidence_repo_lines(%{repos: repos}) when is_map(repos) and map_size(repos) > 0 do
    repos
    |> Enum.sort_by(fn {name, _cfg} -> name end)
    |> Enum.map(&evidence_repo_line/1)
    |> Enum.reject(&is_nil/1)
  end

  defp evidence_repo_lines(_evidence), do: []

  defp evidence_repo_line({name, cfg}) when is_map(cfg) do
    parts =
      [
        evidence_command_part("unit", Map.get(cfg, :unit_command)),
        evidence_command_part("e2e", get_in(cfg, [:e2e, :command])),
        evidence_list_part("UI paths", Map.get(cfg, :ui_paths)),
        evidence_list_part("impacts", Map.get(cfg, :impacts))
      ]
      |> Enum.reject(&is_nil/1)

    case parts do
      [] -> nil
      parts -> "- `#{name}`: " <> Enum.join(parts, " · ")
    end
  end

  defp evidence_repo_line(_entry), do: nil

  defp evidence_command_part(label, command) when is_binary(command) and command != "",
    do: "#{label} `#{command}`"

  defp evidence_command_part(_label, _command), do: nil

  defp evidence_list_part(label, values) when is_list(values) and values != [],
    do: "#{label} `#{Enum.join(values, ", ")}`"

  defp evidence_list_part(_label, _values), do: nil

  @doc false
  @spec preview_context_section(SymphonyElixir.Issue.t()) :: String.t()
  def preview_context_section(%SymphonyElixir.Issue{project_slug: slug, identifier: id})
      when is_binary(slug) and slug != "" and is_binary(id) and id != "" do
    case DevServer.issue_targets(slug, id) do
      {:ok, view} ->
        format_preview_context(slug, id, view)

      {:error, _reason} ->
        ""
    end
  end

  def preview_context_section(_issue), do: ""

  defp format_preview_context(project_slug, identifier, view) when is_map(view) do
    available = Map.get(view, :available, false)
    reason = Map.get(view, :reason)
    servers = Map.get(view, :servers, [])

    server_lines =
      servers
      |> Enum.map(&preview_server_line/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")

    availability =
      if available do
        "Preview is **available** for this issue."
      else
        "Preview is **not available**#{if reason, do: " (#{reason})", else: ""}."
      end

    """
    ## Issue preview (Symphony)

    #{availability}

    Use the **`manage_preview`** tool (`action`: `status` | `start` | `restart`) before UI e2e evidence.
    Do **not** run bare `npx playwright test` on random ports — use the project's configured
    e2e command (see the `evidence` config / project workflow), which reuses the preview ports
    below and the project's isolated e2e database.

    Preview is **best-effort**: `manage_preview start` returns quickly even while a server is still
    booting or after it crashed (read the result's `status`/`next_steps`). If preview does not reach
    `ready`, do **not** block the run on it — keep writing the tests, run the unit suite, record the
    preview blocker in your `## Codex Workpad`, and either poll `manage_preview status`/`restart` later
    or proceed without UI e2e (CI can run it). Never retry a failing preview in a tight loop.

    #{if server_lines == "", do: "_No preview servers registered yet — call `manage_preview` with `start`._", else: server_lines}

    Project: `#{project_slug}` · Issue: `#{identifier}`
    """
  end

  defp preview_server_line(server) when is_map(server) do
    slug = Map.get(server, :slug) || Map.get(server, "slug") || "?"
    status = Map.get(server, :status) || Map.get(server, "status") || "unknown"
    port = Map.get(server, :port) || Map.get(server, "port")
    primary = Map.get(server, :primary) || Map.get(server, "primary")
    local_url = local_preview_url(server)

    primary_tag = if primary, do: " (primary UI)", else: ""

    "- `#{slug}`#{primary_tag}: status=#{status}, port=#{inspect(port)}, local=#{local_url}"
  end

  defp preview_server_line(_), do: ""

  defp local_preview_url(server) when is_map(server) do
    port = Map.get(server, :port) || Map.get(server, "port")
    slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")

    cond do
      not is_integer(port) or port <= 0 ->
        "n/a"

      String.contains?(slug, "admin") ->
        "http://127.0.0.1:#{port}/"

      true ->
        "http://127.0.0.1:#{port}/api/health"
    end
  end

  defp local_preview_url(_), do: "n/a"

  defp resolve_config!(%SymphonyElixir.Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        project
        |> Repo.preload(:setup)
        |> ProjectConfig.resolve_runnable()
        |> case do
          {:ok, %ProjectConfig{} = config} ->
            config

          {:skip, reason} ->
            raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{reason}"
        end

      {:error, reason} ->
        raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{inspect(reason)}"
    end
  end

  defp resolve_config!(%SymphonyElixir.Issue{} = issue) do
    raise RuntimeError, "prompt_unresolved: issue=#{inspect(issue.id)} reason=no project_slug"
  end

  defp parse_template!(prompt) when is_binary(prompt) do
    Solid.parse!(prompt)
  rescue
    error ->
      reraise %RuntimeError{
                message: "template_parse_error: #{Exception.message(error)} template=#{inspect(prompt)}"
              },
              __STACKTRACE__
  end

  defp to_solid_map(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), to_solid_value(value)} end)
  end

  defp to_solid_value(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp to_solid_value(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp to_solid_value(%Date{} = value), do: Date.to_iso8601(value)
  defp to_solid_value(%Time{} = value), do: Time.to_iso8601(value)
  defp to_solid_value(%_{} = value), do: value |> Map.from_struct() |> to_solid_map()
  defp to_solid_value(value) when is_map(value), do: to_solid_map(value)
  defp to_solid_value(value) when is_list(value), do: Enum.map(value, &to_solid_value/1)
  defp to_solid_value(value), do: value

  defp ensure_utf8(binary) when is_binary(binary) do
    if String.valid?(binary) do
      binary
    else
      # Replace invalid bytes so Jason.encode! won't crash
      binary
      |> :unicode.characters_to_binary(:latin1, :utf8)
      |> case do
        result when is_binary(result) -> result
        _ -> String.replace(binary, ~r/[^\x00-\x7F]/, "\uFFFD")
      end
    end
  end

  defp discussion_section(%SymphonyElixir.Issue{comments: comments}) when is_list(comments) and comments != [] do
    body =
      comments
      |> Enum.map(&discussion_comment/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")

    if body == "" do
      ""
    else
      """

      ## Recent discussion (issue + PR)

      Symphony injected the latest comments below. On **Rework**, treat human feedback here as required input before coding.

      #{body}
      """
    end
  end

  defp discussion_section(_issue), do: ""

  defp discussion_comment(%{author: author, body: body, created_at: created_at, source: source})
       when is_binary(body) and body != "" do
    header =
      [author, source, format_comment_timestamp(created_at)]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.join(" — ")

    if header == "" do
      body
    else
      "---\n**#{header}**\n\n#{body}"
    end
  end

  defp discussion_comment(%{body: body}) when is_binary(body) and body != "", do: body
  defp discussion_comment(_comment), do: ""

  defp format_comment_timestamp(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp format_comment_timestamp(%NaiveDateTime{} = datetime), do: NaiveDateTime.to_iso8601(datetime)

  defp format_comment_timestamp(value) when is_binary(value) and value != "", do: value
  defp format_comment_timestamp(_value), do: nil

  defp artifacts_section(workspace) when is_binary(workspace) do
    base = Path.join(workspace, "docs/superpowers")

    if File.dir?(base) do
      files =
        ["specs", "plans"]
        |> Enum.flat_map(fn dir -> base |> Path.join(dir) |> list_markdown_files() end)
        |> Kernel.++(handoff_file(base))

      case files do
        [] ->
          ""

        list ->
          {rendered_artifacts, skipped_count} = render_artifacts(workspace, list)

          "\n\n## Existing authoring artifacts (follow these)\n\n" <>
            (rendered_artifacts
             |> append_artifact_budget_marker(skipped_count)
             |> Enum.join(@artifact_separator))
      end
    else
      ""
    end
  end

  defp artifacts_section(_workspace), do: ""

  defp list_markdown_files(directory) do
    case File.ls(directory) do
      {:ok, entries} ->
        entries
        |> Enum.sort()
        |> Enum.map(&Path.join(directory, &1))
        |> Enum.filter(&regular_markdown_file?/1)

      {:error, _reason} ->
        []
    end
  end

  defp handoff_file(base) do
    file = Path.join(base, "handoff.md")

    if regular_markdown_file?(file) do
      [file]
    else
      []
    end
  end

  defp regular_markdown_file?(path) do
    Path.extname(path) == ".md" and
      match?({:ok, %File.Stat{type: :regular}}, File.lstat(path))
  end

  # credo:disable-for-next-line Credo.Check.Refactor.Nesting
  defp render_artifacts(workspace, files) do
    file_count = length(files)

    result =
      files
      |> Enum.with_index()
      |> Enum.reduce_while({[], 0, 0, 0}, fn {file, index}, {artifacts, artifact_count, bytes_used, _skipped_count} ->
        if artifact_count >= @max_artifacts do
          {:halt, {artifacts, artifact_count, bytes_used, file_count - index}}
        else
          case render_artifact(workspace, file, bytes_used, artifacts == []) do
            {:ok, rendered_artifact, updated_bytes} ->
              {:cont, {[rendered_artifact | artifacts], artifact_count + 1, updated_bytes, 0}}

            :budget_exceeded ->
              {:halt, {artifacts, artifact_count, bytes_used, file_count - index}}
          end
        end
      end)

    {artifacts, _artifact_count, _bytes_used, skipped_count} = result
    {Enum.reverse(artifacts), skipped_count}
  end

  defp render_artifact(workspace, file, bytes_used, first_artifact?) do
    relative_path = Path.relative_to(file, workspace)
    prefix = "### `#{relative_path}`\n\n"
    separator_bytes = if first_artifact?, do: 0, else: byte_size(@artifact_separator)
    remaining_bytes = @max_artifact_section_bytes - bytes_used - separator_bytes

    if remaining_bytes <= 0 do
      :budget_exceeded
    else
      do_render_artifact(file, prefix, bytes_used + separator_bytes, remaining_bytes)
    end
  end

  # credo:disable-for-next-line Credo.Check.Refactor.Nesting
  defp do_render_artifact(file, prefix, updated_bytes_used, remaining_bytes) do
    case File.stat(file) do
      {:ok, %File.Stat{size: size}} when size > @artifact_max_bytes ->
        render_artifact_body(prefix, @artifact_too_large_message, updated_bytes_used, remaining_bytes)

      {:ok, %File.Stat{size: size}} ->
        if byte_size(prefix) + size > remaining_bytes do
          :budget_exceeded
        else
          case File.read(file) do
            {:ok, body} ->
              body = ensure_utf8(body)
              render_artifact_body(prefix, body, updated_bytes_used, remaining_bytes)

            {:error, _reason} ->
              render_artifact_body(prefix, @artifact_unreadable_message, updated_bytes_used, remaining_bytes)
          end
        end

      {:error, _reason} ->
        render_artifact_body(prefix, @artifact_unreadable_message, updated_bytes_used, remaining_bytes)
    end
  end

  defp render_artifact_body(prefix, body, updated_bytes_used, remaining_bytes) do
    rendered_artifact = prefix <> body
    artifact_bytes = byte_size(rendered_artifact)

    if artifact_bytes <= remaining_bytes do
      {:ok, rendered_artifact, updated_bytes_used + artifact_bytes}
    else
      :budget_exceeded
    end
  end

  defp append_artifact_budget_marker(artifacts, 0), do: artifacts

  defp append_artifact_budget_marker(artifacts, skipped_count) do
    artifacts ++ ["_Skipped #{skipped_count} additional authoring artifact(s) due to prompt size limits._"]
  end
end
