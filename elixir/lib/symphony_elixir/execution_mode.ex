defmodule SymphonyElixir.ExecutionMode do
  @moduledoc """
  Pure mapping from the operator-facing execution mode (`plan` / `build` / `yolo`)
  to per-adapter execution policy knobs.

  Jean exposes three execution modes; Symphony reuses the same vocabulary but maps
  each mode onto the concrete sandbox / permission ceiling for every coding-agent
  adapter. Because orchestrator runs are non-interactive there is no human to approve
  individual actions mid-run, so the mode primarily varies the **sandbox / permission
  ceiling** rather than human approval:

  | mode  | codex sandbox        | codex approval | claude permission_mode | cursor `--force` | opencode agent |
  | ----- | -------------------- | -------------- | ---------------------- | ---------------- | -------------- |
  | plan  | `read-only`          | `never`        | `plan`                 | no               | `plan`         |
  | build | `workspace-write`    | `never`        | `acceptEdits`          | no               | `build`        |
  | yolo  | `danger-full-access` | `never`        | `bypassPermissions`    | yes              | `build`        |

  `cursor-agent` has no read-only mode, so `plan` is not offered for cursor
  (see `available_for/1`); callers that still pass `plan` for cursor should fall
  back to `build`.

  Any unknown / nil mode is coerced to `default/0` (`"build"`) so the orchestrator
  never crashes on a stale or malformed selection.
  """

  @plan "plan"
  @build "build"
  @yolo "yolo"

  @modes [@plan, @build, @yolo]
  @default @build

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
  Codex sandbox + approval policy for `mode`.

  Approval always stays `"never"` because orchestrator runs are non-interactive;
  only the sandbox ceiling escalates with the mode.
  """
  @spec codex_policy(term()) :: codex_policy()
  def codex_policy(mode) do
    %{sandbox: codex_sandbox(normalize(mode)), approval_policy: "never"}
  end

  @doc "Claude `permission_mode` flag for `mode`."
  @spec claude_permission_mode(term()) :: String.t()
  def claude_permission_mode(mode) do
    case normalize(mode) do
      @plan -> "plan"
      @yolo -> "bypassPermissions"
      _build -> "acceptEdits"
    end
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
