defmodule SymphonyElixir.DevServer.RuntimeReport do
  @moduledoc """
  Pure domain model for a preview runtime report (v1).

  A serve process writes this JSON document atomically (temp file + rename) at
  every lifecycle transition to the `report_path` named by its
  `SymphonyElixir.DevServer.RuntimeContract`. Symphony reads it to learn which
  allowed port the process actually bound.

  A report is only meaningful relative to a contract: `evaluate/2` returns the
  accepted port when the report echoes the contract identity and revision, is in
  a `ready` state, and its `actual_port` is inside the contract's allowed set.
  Any other outcome is an explicit rejection reason and must never rewrite the
  authoritative record. This module performs no IO beyond JSON decoding.
  """

  alias SymphonyElixir.DevServer.RuntimeContract

  @current_version 1
  @states ~w(starting ready stopped error)

  @enforce_keys [:contract_id, :revision, :state]
  defstruct version: @current_version,
            contract_id: nil,
            revision: nil,
            server_slug: nil,
            state: nil,
            selected_port: nil,
            actual_port: nil,
            pid: nil,
            session_name: nil,
            reported_at: nil,
            error: nil

  @type t :: %__MODULE__{
          version: pos_integer(),
          contract_id: String.t(),
          revision: pos_integer(),
          server_slug: String.t() | nil,
          state: String.t(),
          selected_port: pos_integer() | nil,
          actual_port: pos_integer() | nil,
          pid: pos_integer() | nil,
          session_name: String.t() | nil,
          reported_at: DateTime.t() | nil,
          error: String.t() | nil
        }

  @spec current_version() :: pos_integer()
  def current_version, do: @current_version

  @doc "Parse and validate a report from its raw JSON document."
  @spec parse(binary()) :: {:ok, t()} | {:error, atom()}
  def parse(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, map} when is_map(map) -> from_map(map)
      {:ok, _other} -> {:error, :invalid_report_shape}
      {:error, _reason} -> {:error, :invalid_json}
    end
  end

  def parse(_json), do: {:error, :invalid_json}

  @doc "Build and validate a report from a decoded map (atom or string keys)."
  @spec from_map(map()) :: {:ok, t()} | {:error, atom()}
  def from_map(map) when is_map(map) do
    report = %__MODULE__{
      version: to_int(fetch(map, :version), @current_version),
      contract_id: to_str(fetch(map, :contract_id)),
      revision: to_int(fetch(map, :revision), nil),
      server_slug: to_str(fetch(map, :server_slug)),
      state: to_str(fetch(map, :state)),
      selected_port: to_int(fetch(map, :selected_port), nil),
      actual_port: to_int(fetch(map, :actual_port), nil),
      pid: to_int(fetch(map, :pid), nil),
      session_name: to_str(fetch(map, :session_name)),
      reported_at: parse_datetime(fetch(map, :reported_at)),
      error: to_str(fetch(map, :error))
    }

    validate(report)
  end

  def from_map(_map), do: {:error, :invalid_report_shape}

  @spec validate(t()) :: {:ok, t()} | {:error, atom()}
  def validate(%__MODULE__{} = report) do
    with :ok <- check_version(report),
         :ok <- check_contract_id(report),
         :ok <- check_revision(report),
         :ok <- check_state(report) do
      {:ok, report}
    end
  end

  @doc """
  Decide whether a report may be accepted for its contract.

  Returns `{:ok, actual_port}` only when identity, revision, server, and
  readiness all agree and the actual port is inside the contract's allowed set.
  Every other result is an explicit rejection reason that leaves the
  authoritative record untouched.
  """
  @spec evaluate(t(), RuntimeContract.t()) :: {:ok, pos_integer()} | {:error, atom()}
  def evaluate(%__MODULE__{} = report, %RuntimeContract{} = contract) do
    cond do
      report.contract_id != contract.contract_id -> {:error, :contract_id_mismatch}
      server_mismatch?(report, contract) -> {:error, :server_mismatch}
      report.revision < contract.revision -> {:error, :stale_revision}
      report.revision > contract.revision -> {:error, :revision_mismatch}
      report.state == "error" -> {:error, :reported_error}
      report.state != "ready" -> {:error, :not_ready}
      is_nil(report.actual_port) -> {:error, :missing_actual_port}
      not RuntimeContract.port_allowed?(contract, report.actual_port) -> {:error, :port_out_of_range}
      true -> {:ok, report.actual_port}
    end
  end

  @doc "Serialize a report to a JSON-ready map (string keys)."
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = report) do
    %{
      "version" => report.version,
      "contract_id" => report.contract_id,
      "revision" => report.revision,
      "server_slug" => report.server_slug,
      "state" => report.state,
      "selected_port" => report.selected_port,
      "actual_port" => report.actual_port,
      "pid" => report.pid,
      "session_name" => report.session_name,
      "reported_at" => encode_datetime(report.reported_at),
      "error" => report.error
    }
  end

  @spec encode(t()) :: {:ok, binary()} | {:error, term()}
  def encode(%__MODULE__{} = report) do
    Jason.encode(to_map(report))
  end

  defp server_mismatch?(%{server_slug: nil}, _contract), do: false
  defp server_mismatch?(%{server_slug: slug}, %{server_slug: slug}), do: false
  defp server_mismatch?(_report, _contract), do: true

  defp check_version(%{version: @current_version}), do: :ok
  defp check_version(_), do: {:error, :unsupported_version}

  defp check_contract_id(%{contract_id: id}) when is_binary(id) and byte_size(id) > 0, do: :ok
  defp check_contract_id(_), do: {:error, :invalid_contract_id}

  defp check_revision(%{revision: rev}) when is_integer(rev) and rev >= 1, do: :ok
  defp check_revision(_), do: {:error, :invalid_revision}

  defp check_state(%{state: state}) when state in @states, do: :ok
  defp check_state(_), do: {:error, :invalid_state}

  defp fetch(map, key) do
    case Map.fetch(map, key) do
      {:ok, value} ->
        value

      :error ->
        case Map.fetch(map, Atom.to_string(key)) do
          {:ok, value} -> value
          :error -> nil
        end
    end
  end

  defp to_str(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp to_str(_value), do: nil

  defp to_int(value, _default) when is_integer(value), do: value

  defp to_int(value, default) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {int, _rest} -> int
      :error -> default
    end
  end

  defp to_int(_value, default), do: default

  defp parse_datetime(%DateTime{} = value), do: value

  defp parse_datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> datetime
      {:error, _reason} -> nil
    end
  end

  defp parse_datetime(_value), do: nil

  defp encode_datetime(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp encode_datetime(_value), do: nil
end
