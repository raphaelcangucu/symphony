defmodule SymphonyElixir.LocalTracker.PreviewRuntimeContract do
  @moduledoc """
  Persisted active preview runtime contract for one issue service.

  This is the durable mirror of `SymphonyElixir.DevServer.RuntimeContract`. It is
  intentionally separate from `DevServerRecord` (the accepted-runtime mirror):
  the contract is Symphony's authoritative offer, the record is what a validated
  report proved is actually running.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.LocalTracker.Project

  @type t :: %__MODULE__{}
  @sources ~w(managed contracted_manual)
  @ready_probes ~w(http tcp)
  @max_port 65_535

  schema "local_tracker_preview_runtime_contracts" do
    field(:issue_identifier, :string)
    field(:server_slug, :string)
    field(:contract_id, :string)
    field(:revision, :integer, default: 1)
    field(:source, :string)
    field(:preferred_port, :integer)
    field(:allowed_ports, {:array, :integer}, default: [])
    field(:report_path, :string)
    field(:ready_probe, :string, default: "tcp")
    field(:ready_path, :string, default: "/")
    field(:url_path, :string, default: "/")
    field(:port_env, :string)
    field(:expires_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(record, attrs) do
    record
    |> cast(attrs, [
      :project_id,
      :issue_identifier,
      :server_slug,
      :contract_id,
      :revision,
      :source,
      :preferred_port,
      :allowed_ports,
      :report_path,
      :ready_probe,
      :ready_path,
      :url_path,
      :port_env,
      :expires_at
    ])
    |> validate_required([
      :project_id,
      :issue_identifier,
      :server_slug,
      :contract_id,
      :revision,
      :source,
      :preferred_port,
      :allowed_ports,
      :report_path,
      :port_env,
      :expires_at
    ])
    |> validate_inclusion(:source, @sources)
    |> validate_inclusion(:ready_probe, @ready_probes)
    |> validate_number(:revision, greater_than_or_equal_to: 1)
    |> validate_number(:preferred_port, greater_than: 0, less_than_or_equal_to: @max_port)
    |> validate_allowed_ports()
    |> unique_constraint([:project_id, :issue_identifier, :server_slug])
    |> unique_constraint(:contract_id)
  end

  defp validate_allowed_ports(changeset) do
    validate_change(changeset, :allowed_ports, fn :allowed_ports, ports ->
      cond do
        ports == [] ->
          [allowed_ports: "must not be empty"]

        not Enum.all?(ports, &(is_integer(&1) and &1 > 0 and &1 <= @max_port)) ->
          [allowed_ports: "must all be valid ports"]

        get_field(changeset, :preferred_port) not in ports ->
          [allowed_ports: "must include the preferred port"]

        true ->
          []
      end
    end)
  end
end
