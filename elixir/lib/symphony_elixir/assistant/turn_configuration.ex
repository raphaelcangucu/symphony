defmodule SymphonyElixir.Assistant.TurnConfiguration do
  @moduledoc """
  Resolves per-turn agent configuration from session context, mode, and skill profile.

  Returns a validated map used by `AgentSession` prompts and the assistant channel.
  Fail-fast on blank scope when required; unknown modes/profiles coerce to safe defaults.
  """

  alias SymphonyElixir.Assistant.SkillProfiles
  alias SymphonyElixir.ExecutionMode

  @type runtime :: String.t()
  @type t :: %{
          scope: String.t() | nil,
          mode: String.t(),
          skill_profile: String.t(),
          skill_profile_selection: String.t(),
          runtime: runtime(),
          preload_slugs: [String.t()],
          visible_slugs: [String.t()],
          allows_writes?: boolean(),
          mode_locked?: boolean()
        }

  @interactive "interactive"
  @autonomous "autonomous"

  @doc """
  Builds a turn configuration.

  Options:
    * `:scope` — thread scope (`issue`, `issue_session`, `project_explore`, …)
    * `:mode` — plan/build/yolo (nil → default for scope)
    * `:skill_profile` — profile id or `auto` (nil → `auto`)
    * `:runtime` — `interactive` | `autonomous` (default `interactive`)
  """
  @spec resolve(keyword() | map()) :: t()
  def resolve(opts) when is_list(opts), do: resolve(Map.new(opts))

  def resolve(opts) when is_map(opts) do
    scope = normalize_scope(Map.get(opts, :scope) || Map.get(opts, "scope"))
    runtime = normalize_runtime(Map.get(opts, :runtime) || Map.get(opts, "runtime"))
    mode_locked? = mode_locked?(scope, runtime)
    mode = resolve_mode(Map.get(opts, :mode) || Map.get(opts, "mode"), scope, runtime, mode_locked?)

    selection =
      SkillProfiles.normalize(Map.get(opts, :skill_profile) || Map.get(opts, "skill_profile") || SkillProfiles.auto())

    profile_id = SkillProfiles.resolve(selection, scope, mode, runtime: runtime)
    profile = SkillProfiles.get(profile_id)

    %{
      scope: scope,
      mode: mode,
      skill_profile: profile_id,
      skill_profile_selection: selection,
      runtime: runtime,
      preload_slugs: profile.preload,
      visible_slugs: profile.visible,
      allows_writes?: mode in ["build", "yolo"] and runtime == @interactive,
      mode_locked?: mode_locked?
    }
  end

  @doc "Default interactive mode for a session scope."
  @spec default_mode(String.t() | nil, runtime()) :: String.t()
  def default_mode(scope, runtime \\ @interactive)

  def default_mode(_scope, @autonomous), do: ExecutionMode.default()

  def default_mode(scope, _runtime) do
    case scope do
      "project_explore" -> "plan"
      "issue" -> "plan"
      "project" -> "plan"
      "issue_session" -> "build"
      "project_session" -> "build"
      _ -> "plan"
    end
  end

  @doc "Whether the mode picker is locked to Plan for this surface."
  @spec mode_locked?(String.t() | nil, runtime()) :: boolean()
  def mode_locked?("project_explore", _), do: true
  def mode_locked?(_scope, @autonomous), do: false
  def mode_locked?(_scope, _), do: false

  @spec normalize_runtime(term()) :: runtime()
  def normalize_runtime(value) when value in [@autonomous, "autonomous"], do: @autonomous
  def normalize_runtime(_), do: @interactive

  defp resolve_mode(nil, scope, runtime, mode_locked?) do
    mode = default_mode(scope, runtime)
    if mode_locked?, do: "plan", else: mode
  end

  defp resolve_mode(_mode, _scope, _runtime, true), do: "plan"

  defp resolve_mode(mode, _scope, _runtime, false) do
    ExecutionMode.normalize(mode)
  end

  defp normalize_scope(scope) when is_binary(scope) do
    case String.trim(scope) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_scope(_), do: nil
end
