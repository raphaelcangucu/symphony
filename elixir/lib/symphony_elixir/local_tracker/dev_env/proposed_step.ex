defmodule SymphonyElixir.LocalTracker.DevEnv.ProposedStep do
  @moduledoc "An ephemeral, un-persisted dev-env step proposal."

  @enforce_keys [:description, :command, :source]
  defstruct [:description, :command, :working_dir, :source, optional: false]

  @type t :: %__MODULE__{
          description: String.t(),
          command: String.t(),
          working_dir: String.t() | nil,
          source: String.t(),
          optional: boolean()
        }

  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      description: fetch(attrs, :description),
      command: fetch(attrs, :command),
      working_dir: get(attrs, :working_dir),
      source: get(attrs, :source) || "manual",
      optional: get(attrs, :optional) || false
    }
  end

  defp fetch(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key)) || raise(ArgumentError, "missing #{key}")
  defp get(attrs, key), do: Map.get(attrs, key, Map.get(attrs, Atom.to_string(key)))
end
