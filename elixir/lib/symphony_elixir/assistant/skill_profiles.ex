defmodule SymphonyElixir.Assistant.SkillProfiles do
  @moduledoc """
  Pure registry of interactive Skill Toolkits (profiles).

  Mode (`plan` / `build` / `yolo`) controls sandbox/approvals. Skill profiles
  control which methodology is preloaded and which skills appear in the palette.
  The two axes are intentionally orthogonal: Auto picks a default profile from
  mode + session context, but the operator can pin a different profile.
  """

  @planning "planning"
  @implementation "implementation"
  @debugging "debugging"
  @delivery "delivery"
  @explore "explore"
  @orchestrator "orchestrator"
  @auto "auto"

  @profiles [@planning, @implementation, @debugging, @delivery, @explore, @orchestrator]
  @selectable [@auto | @profiles -- [@orchestrator]]

  @legacy_aliases %{
    "authoring" => @planning,
    "execution" => @implementation
  }

  @type id :: String.t()

  @type profile :: %{
          id: id(),
          preload: [String.t()],
          visible: [String.t()]
        }

  @spec all() :: [id()]
  def all, do: @profiles

  @spec selectable() :: [id()]
  def selectable, do: @selectable

  @spec valid?(term()) :: boolean()
  def valid?(value) when is_binary(value), do: value in @profiles or value == @auto
  def valid?(_value), do: false

  @doc """
  Coerces input to a known profile id.

  Accepts legacy slash contexts (`authoring`, `execution`). Unknown values fall
  back to `auto`.
  """
  @spec normalize(term()) :: id()
  def normalize(value) when is_binary(value) do
    lowered = String.downcase(String.trim(value))

    cond do
      lowered == @auto ->
        @auto

      lowered in @profiles ->
        lowered

      true ->
        case Map.fetch(@legacy_aliases, lowered) do
          {:ok, mapped} -> mapped
          :error -> @auto
        end
    end
  end

  def normalize(_value), do: @auto

  @spec auto() :: id()
  def auto, do: @auto

  @spec planning() :: id()
  def planning, do: @planning

  @spec implementation() :: id()
  def implementation, do: @implementation

  @spec explore() :: id()
  def explore, do: @explore

  @spec orchestrator() :: id()
  def orchestrator, do: @orchestrator

  @doc "Resolved profile definition. `auto` is not a concrete profile — resolve first."
  @spec get(term()) :: profile()
  def get(id) do
    case normalize(id) do
      @auto -> get(@planning)
      @planning -> planning_profile()
      @implementation -> implementation_profile()
      @debugging -> debugging_profile()
      @delivery -> delivery_profile()
      @explore -> explore_profile()
      @orchestrator -> orchestrator_profile()
    end
  end

  @doc """
  Picks the Auto profile for a session scope + agent mode.

  - `project_explore` → explore
  - orchestrator / autonomous runtime → orchestrator
  - mode `plan` → planning
  - mode `build` / `yolo` → implementation
  """
  @spec resolve_auto(String.t() | nil, String.t() | nil, keyword()) :: id()
  def resolve_auto(scope, mode, opts \\ []) do
    runtime = Keyword.get(opts, :runtime, "interactive")

    cond do
      runtime == "autonomous" -> @orchestrator
      scope in ["project_explore"] -> @explore
      mode == "plan" -> @planning
      mode in ["build", "yolo"] -> @implementation
      true -> @planning
    end
  end

  @doc """
  Resolves the effective profile id given an explicit selection (or `auto`).
  """
  @spec resolve(term(), String.t() | nil, String.t() | nil, keyword()) :: id()
  def resolve(selection, scope, mode, opts \\ []) do
    case normalize(selection) do
      @auto -> resolve_auto(scope, mode, opts)
      other -> other
    end
  end

  @spec preload_slugs(term()) :: [String.t()]
  def preload_slugs(id), do: get(id).preload

  @spec visible_slugs(term()) :: [String.t()]
  def visible_slugs(id), do: get(id).visible

  @spec planning_only_skills() :: [String.t()]
  def planning_only_skills,
    do: ~w(brainstorming using-superpowers writing-plans writing-skills)

  defp planning_profile do
    %{
      id: @planning,
      preload: ~w(brainstorming writing-plans),
      visible: ~w(brainstorming writing-plans using-superpowers writing-skills)
    }
  end

  defp implementation_profile do
    %{
      id: @implementation,
      preload: ~w(test-driven-development verification-before-completion),
      visible: ~w(test-driven-development verification-before-completion systematic-debugging requesting-code-review)
    }
  end

  defp debugging_profile do
    %{
      id: @debugging,
      preload: ~w(systematic-debugging verification-before-completion),
      visible: ~w(systematic-debugging verification-before-completion test-driven-development)
    }
  end

  defp delivery_profile do
    %{
      id: @delivery,
      preload: ~w(requesting-code-review verification-before-completion),
      visible: ~w(requesting-code-review verification-before-completion finishing-a-development-branch)
    }
  end

  defp explore_profile do
    %{
      id: @explore,
      preload: [],
      visible: ~w(using-superpowers)
    }
  end

  defp orchestrator_profile do
    %{
      id: @orchestrator,
      preload: ~w(subagent-driven-development),
      visible: ~w(subagent-driven-development verification-before-completion)
    }
  end
end
