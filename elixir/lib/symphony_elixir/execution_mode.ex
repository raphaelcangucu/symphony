defmodule SymphonyElixir.ExecutionMode do
  @moduledoc """
  Pure mapping from the operator-facing execution mode (`plan` / `build` / `yolo`)
  to per-adapter execution policy knobs.

  Symphony exposes three execution modes and maps each onto the concrete sandbox /
  permission ceiling for every coding-agent adapter. The mapping is **context
  aware**: some knobs depend on whether the run is *interactive* (a human is
  attached to the assistant / workspace chat and can approve individual actions)
  or *autonomous* (the orchestrator auto-started an issue and no human is present
  to approve mid-run).

  | mode  | codex sandbox        | codex approval (interactive) | codex approval (autonomous) | claude permission_mode (interactive) | claude permission_mode (autonomous) | cursor `--force` | opencode agent |
  | ----- | -------------------- | ---------------------------- | --------------------------- | ------------------------------------- | ------------------------------------ | ---------------- | -------------- |
  | plan  | `read-only`          | honor project config         | honor project config        | `plan`                                | `plan`                               | no               | `plan`         |
  | build | `workspace-write`    | `on-request` (prompt)        | `never`                     | `default` (prompt via MCP)            | `bypassPermissions`                  | no               | `build`        |
  | yolo  | `danger-full-access` | `never`                      | `never`                     | `bypassPermissions`                   | `bypassPermissions`                  | yes              | `build`        |

  ## Why `build` differs from `yolo`

  `build` is the human-in-the-loop mode: when the agent wants to run a command the
  assistant surfaces an approval prompt and the operator approves (the agent then
  continues) instead of the turn hard-failing on "This command requires approval".
  `yolo` never prompts. Because approval requires a human, `build` only prompts in
  interactive sessions; an autonomous `build` run falls back to the no-prompt
  ceiling so it cannot stall waiting for a click that will never come.

  Claude has no OS-level sandbox, so its only knob is `permission_mode`. In a
  headless (`--print`) run there is no TTY to approve tool use, and `acceptEdits`
  still prompts for `Bash` and other non-edit tools — silently failing every shell
  command. Interactive `build` therefore runs Claude with `--permission-mode default`
  **plus** an MCP `--permission-prompt-tool` that pipes approval requests back to
  the operator (see `claude_interactive_approval?/2`); autonomous `build` and every
  `yolo` run use `bypassPermissions`; only `plan` stays read-only.

  `cursor-agent` has no read-only mode, so `plan` is not offered for cursor
  (see `available_for/1`); callers that still pass `plan` for cursor should fall
  back to `build`.

  The default is `yolo` (full access, no approval prompts) because non-interactive
  agent runs cannot recover from a mid-run approval request. Any unknown / nil mode
  is coerced to `default/0` (`"yolo"`) so the orchestrator never crashes on a stale
  or malformed selection.
  """

  @plan "plan"
  @build "build"
  @yolo "yolo"

  @modes [@plan, @build, @yolo]
  @default @yolo

  # Codex `approvalPolicy` value used for interactive `build`: the app-server asks
  # the operator before running a command. Must be one of the values Codex accepts
  # (`untrusted | on-failure | on-request | granular | never`).
  @codex_prompt_policy "on-request"
  @codex_never_policy "never"

  @type t :: String.t()

  @type codex_policy :: %{sandbox: String.t(), approval_policy: String.t()}

  @doc "Every supported execution mode, in operator-facing order."
  @spec all() :: [t()]
  def all, do: @modes

  @doc "The default execution mode used when none is selected or the value is invalid."
  @spec default() :: t()
  def default, do: @default

  @doc "Returns true when `value` is a recognized execution mode."
  @spec valid?(term()) :: boolean()
  def valid?(value) when is_binary(value), do: value in @modes
  def valid?(_value), do: false

  @doc "Coerces any input to a valid execution mode, falling back to `default/0`."
  @spec normalize(term()) :: t()
  def normalize(value) do
    if valid?(value), do: value, else: @default
  end

  @doc """
  Codex sandbox + approval policy for `mode` (autonomous / non-interactive ceiling).

  Kept for callers that don't carry an interactivity signal; approval stays
  `"never"` because a run with no human can't answer a prompt. For the interactive
  ceiling, use `codex_approval_override/2` (which the adapter applies on top of the
  project config).
  """
  @spec codex_policy(term()) :: codex_policy()
  def codex_policy(mode) do
    %{sandbox: codex_sandbox(normalize(mode)), approval_policy: @codex_never_policy}
  end

  @doc """
  How the Codex `approvalPolicy` should be overridden for `mode` given whether the
  run is interactive.

  Returns `{:force, policy}` when the mode dictates the approval policy, or
  `:honor_config` when the project/instance configured policy should stand.

    * `yolo` — always `{:force, "never"}`.
    * `build` + interactive — `{:force, "on-request"}` so the operator is prompted
      before commands run.
    * `build` + autonomous — `{:force, "never"}` so an unattended run can't stall.
    * `plan` — `:honor_config` (read-only sandbox makes approval largely moot).
  """
  @spec codex_approval_override(term(), boolean()) :: {:force, String.t()} | :honor_config
  def codex_approval_override(mode, interactive?) when is_boolean(interactive?) do
    case normalize(mode) do
      @yolo -> {:force, @codex_never_policy}
      @build -> {:force, if(interactive?, do: @codex_prompt_policy, else: @codex_never_policy)}
      @plan -> :honor_config
    end
  end

  @doc """
  Claude `permission_mode` flag for `mode`, defaulting to the autonomous ceiling.

  Delegates to `claude_permission_mode/2` with `interactive? = false`.
  """
  @spec claude_permission_mode(term()) :: String.t()
  def claude_permission_mode(mode), do: claude_permission_mode(mode, false)

  @doc """
  Claude `permission_mode` flag for `mode` and interactivity.

    * `plan` → `"plan"` (read-only).
    * `build` + interactive → `"default"` (unmatched tools trigger the MCP
      `--permission-prompt-tool` so the operator can approve).
    * `build` + autonomous → `"bypassPermissions"` (no human to prompt).
    * `yolo` / unknown → `"bypassPermissions"`.
  """
  @spec claude_permission_mode(term(), boolean()) :: String.t()
  def claude_permission_mode(mode, interactive?) when is_boolean(interactive?) do
    case normalize(mode) do
      @plan -> "plan"
      @build -> if interactive?, do: "default", else: "bypassPermissions"
      @yolo -> "bypassPermissions"
    end
  end

  @doc """
  Whether Claude should run with the interactive approval shim for `mode`.

  True only for interactive `build`: that is the single case where Claude runs
  with `--permission-mode default` and must be given a `--permission-prompt-tool`
  so tool approvals reach the operator instead of failing the turn.
  """
  @spec claude_interactive_approval?(term(), boolean()) :: boolean()
  def claude_interactive_approval?(mode, interactive?) when is_boolean(interactive?) do
    normalize(mode) == @build and interactive?
  end

  @doc "Whether cursor-agent should run with `--force` (only on `yolo`)."
  @spec cursor_force?(term()) :: boolean()
  def cursor_force?(mode), do: normalize(mode) == @yolo

  @doc """
  OpenCode `--agent` value for `mode`.

  OpenCode only ships `plan` and `build` agents, so `yolo` maps to `build`
  (full permissions are applied separately by the adapter).
  """
  @spec opencode_agent(term()) :: String.t()
  def opencode_agent(mode) do
    case normalize(mode) do
      @plan -> "plan"
      _build_or_yolo -> "build"
    end
  end

  @doc """
  Modes selectable for `agent_kind`.

  `cursor` excludes `plan` because `cursor-agent` has no read-only execution mode.
  """
  @spec available_for(String.t()) :: [t()]
  def available_for("cursor"), do: [@build, @yolo]
  def available_for(_agent_kind), do: @modes

  @spec codex_sandbox(t()) :: String.t()
  defp codex_sandbox(@plan), do: "read-only"
  defp codex_sandbox(@yolo), do: "danger-full-access"
  defp codex_sandbox(_build), do: "workspace-write"
end
