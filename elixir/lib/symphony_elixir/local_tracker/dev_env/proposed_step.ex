defmodule SymphonyElixir.LocalTracker.DevEnv.ProposedStep do
  @moduledoc "An ephemeral, un-persisted dev-env step proposal."

  @enforce_keys [:description, :command, :source]
  defstruct [
    :description,
    :command,
    :stop_command,
    :working_dir,
    :source,
    :run_spec,
    port_env: nil,
    role: "setup",
    url_path: "/",
    ready_probe: "tcp",
    ready_path: "/",
    primary: false,
    optional: false
  ]

  @type t :: %__MODULE__{
          description: String.t(),
          command: String.t(),
          stop_command: String.t() | nil,
          working_dir: String.t() | nil,
          source: String.t(),
          run_spec: map() | nil,
          role: String.t(),
          port_env: String.t() | nil,
          url_path: String.t(),
          ready_probe: String.t(),
          ready_path: String.t(),
          primary: boolean(),
          optional: boolean()
        }

  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      description: fetch(attrs, :description),
      command: fetch(attrs, :command),
      stop_command: get(attrs, :stop_command),
      working_dir: get(attrs, :working_dir),
      source: get(attrs, :source) || "manual",
      run_spec: get(attrs, :run_spec),
      role: get(attrs, :role) || "setup",
      port_env: get(attrs, :port_env),
      url_path: get(attrs, :url_path) || "/",
      ready_probe: get(attrs, :ready_probe) || "tcp",
      ready_path: get(attrs, :ready_path) || "/",
      primary: get(attrs, :primary) || false,
      optional: get(attrs, :optional) || false
    }
  end

  defp fetch(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key)) || raise(ArgumentError, "missing #{key}")
  defp get(attrs, key), do: Map.get(attrs, key, Map.get(attrs, Atom.to_string(key)))
end
