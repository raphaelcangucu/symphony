defmodule SymphonyElixir.Agent.BackendCapabilities do
  @moduledoc """
  Data-only capability contract for agent backends.

  Callers use this contract before exposing or invoking provider-native
  controls instead of branching on provider names throughout the application.
  """

  @enforce_keys [:provider]
  defstruct provider: nil,
            resume: false,
            interrupt: false,
            steer: false,
            native_goal: false,
            model_selection: false,
            reasoning_effort: false,
            multi_agent: false

  @type t :: %__MODULE__{
          provider: String.t(),
          resume: boolean(),
          interrupt: boolean(),
          steer: boolean(),
          native_goal: boolean(),
          model_selection: boolean(),
          reasoning_effort: boolean(),
          multi_agent: boolean()
        }

  @spec for(term()) :: t()
  def for(provider) do
    provider = normalize_provider(provider)

    case provider do
      "codex" ->
        enabled(provider,
          steer: true,
          native_goal: true,
          reasoning_effort: true,
          multi_agent: true
        )

      "claude" ->
        enabled(provider, native_goal: true, reasoning_effort: true)

      kind when kind in ["cursor", "opencode"] ->
        enabled(kind)

      unsupported ->
        %__MODULE__{provider: unsupported}
    end
  end

  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = capabilities), do: Map.from_struct(capabilities)

  defp enabled(provider, overrides \\ []) do
    struct!(
      __MODULE__,
      Keyword.merge(
        [
          provider: provider,
          resume: true,
          interrupt: true,
          model_selection: true
        ],
        overrides
      )
    )
  end

  defp normalize_provider(provider) when is_atom(provider), do: provider |> Atom.to_string() |> normalize_provider()

  defp normalize_provider(provider) when is_binary(provider) do
    case String.trim(provider) do
      "" -> "unknown"
      normalized -> normalized
    end
  end

  defp normalize_provider(_provider), do: "unknown"
end
