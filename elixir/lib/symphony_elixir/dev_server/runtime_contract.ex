defmodule SymphonyElixir.DevServer.RuntimeContract do
  @moduledoc """
  Pure domain model for a preview runtime contract (v1).

  A contract is Symphony's authoritative offer to a serve process. It names the
  exact ports the process may bind — `preferred_port` plus a disjoint
  `allowed_ports` fallback set — where to atomically write its
  `SymphonyElixir.DevServer.RuntimeReport`, and the identity (`contract_id` plus
  a monotonic `revision`) that a report must echo verbatim to be accepted.

  Contracts are never derived from what a process happens to be doing.
  `LeaseStore` and `PortPlan` remain the only allocation authority; this module
  only validates a proposed contract and serializes it to process environment
  variables. It performs no IO.
  """

  @current_version 1
  @sources [:managed, :contracted_manual]
  @ready_probes ["http", "tcp"]
  @min_port 1
  @max_port 65_535

  @env_version "SYMPHONY_PREVIEW_CONTRACT"
  @env_contract_id "SYMPHONY_PREVIEW_CONTRACT_ID"
  @env_revision "SYMPHONY_PREVIEW_CONTRACT_REVISION"
  @env_source "SYMPHONY_PREVIEW_CONTRACT_SOURCE"
  @env_preferred "SYMPHONY_PREVIEW_PREFERRED_PORT"
  @env_allowed "SYMPHONY_PREVIEW_ALLOWED_PORTS"
  @env_report_path "SYMPHONY_PREVIEW_REPORT_PATH"

  @enforce_keys [
    :contract_id,
    :revision,
    :project_slug,
    :issue_identifier,
    :server_slug,
    :source,
    :preferred_port,
    :allowed_ports,
    :report_path,
    :port_env,
    :expires_at
  ]
  defstruct version: @current_version,
            contract_id: nil,
            revision: nil,
            project_slug: nil,
            issue_identifier: nil,
            server_slug: nil,
            source: nil,
            preferred_port: nil,
            allowed_ports: [],
            report_path: nil,
            ready_probe: "tcp",
            ready_path: "/",
            url_path: "/",
            port_env: nil,
            expires_at: nil

  @type source :: :managed | :contracted_manual

  @type t :: %__MODULE__{
          version: pos_integer(),
          contract_id: String.t(),
          revision: pos_integer(),
          project_slug: String.t(),
          issue_identifier: String.t(),
          server_slug: String.t(),
          source: source(),
          preferred_port: pos_integer(),
          allowed_ports: [pos_integer()],
          report_path: String.t(),
          ready_probe: String.t(),
          ready_path: String.t(),
          url_path: String.t(),
          port_env: String.t(),
          expires_at: DateTime.t()
        }

  @spec current_version() :: pos_integer()
  def current_version, do: @current_version

  @spec env_var_names() :: [String.t()]
  def env_var_names do
    [
      @env_version,
      @env_contract_id,
      @env_revision,
      @env_source,
      @env_preferred,
      @env_allowed,
      @env_report_path
    ]
  end

  @doc """
  Build and validate a contract from a plain map (atom or string keys).
  """
  @spec new(map()) :: {:ok, t()} | {:error, atom()}
  def new(attrs) when is_map(attrs) do
    contract = %__MODULE__{
      version: fetch(attrs, :version, @current_version),
      contract_id: fetch(attrs, :contract_id, nil),
      revision: fetch(attrs, :revision, nil),
      project_slug: fetch(attrs, :project_slug, nil),
      issue_identifier: fetch(attrs, :issue_identifier, nil),
      server_slug: fetch(attrs, :server_slug, nil),
      source: normalize_source(fetch(attrs, :source, nil)),
      preferred_port: fetch(attrs, :preferred_port, nil),
      allowed_ports: normalize_allowed(fetch(attrs, :allowed_ports, []), fetch(attrs, :preferred_port, nil)),
      report_path: fetch(attrs, :report_path, nil),
      ready_probe: fetch(attrs, :ready_probe, "tcp"),
      ready_path: fetch(attrs, :ready_path, "/"),
      url_path: fetch(attrs, :url_path, "/"),
      port_env: fetch(attrs, :port_env, nil),
      expires_at: fetch(attrs, :expires_at, nil)
    }

    validate(contract)
  end

  @spec validate(t()) :: {:ok, t()} | {:error, atom()}
  def validate(%__MODULE__{} = contract) do
    with :ok <- check_version(contract),
         :ok <- check_contract_id(contract),
         :ok <- check_revision(contract),
         :ok <- check_identity(contract),
         :ok <- check_source(contract),
         :ok <- check_preferred_port(contract),
         :ok <- check_allowed_ports(contract),
         :ok <- check_report_path(contract),
         :ok <- check_probe(contract),
         :ok <- check_port_env(contract),
         :ok <- check_expiry(contract) do
      {:ok, contract}
    end
  end

  @doc """
  Serialize the contract to the environment variables a serve process must read
  to honor it. The declared `port_env` (e.g. `INSPIRE_PORT`) is set to the
  preferred port so unmodified scripts still land on the leased port.
  """
  @spec to_env(t()) :: %{optional(String.t()) => String.t()}
  def to_env(%__MODULE__{} = contract) do
    %{
      @env_version => Integer.to_string(contract.version),
      @env_contract_id => contract.contract_id,
      @env_revision => Integer.to_string(contract.revision),
      @env_source => Atom.to_string(contract.source),
      @env_preferred => Integer.to_string(contract.preferred_port),
      @env_allowed => Enum.map_join(contract.allowed_ports, ",", &Integer.to_string/1),
      @env_report_path => contract.report_path,
      contract.port_env => Integer.to_string(contract.preferred_port)
    }
  end

  @spec port_allowed?(t(), integer()) :: boolean()
  def port_allowed?(%__MODULE__{allowed_ports: allowed}, port) when is_integer(port) do
    port in allowed
  end

  def port_allowed?(%__MODULE__{}, _port), do: false

  @spec expired?(t(), DateTime.t()) :: boolean()
  def expired?(%__MODULE__{expires_at: %DateTime{} = expires_at}, %DateTime{} = now) do
    DateTime.compare(now, expires_at) != :lt
  end

  defp normalize_source(:managed), do: :managed
  defp normalize_source(:contracted_manual), do: :contracted_manual
  defp normalize_source("managed"), do: :managed
  defp normalize_source("contracted_manual"), do: :contracted_manual
  defp normalize_source(other), do: other

  defp normalize_allowed(allowed, preferred) when is_list(allowed) do
    [preferred | allowed]
    |> Enum.filter(&is_integer/1)
    |> Enum.uniq()
  end

  defp normalize_allowed(_allowed, _preferred), do: []

  defp check_version(%{version: @current_version}), do: :ok
  defp check_version(_), do: {:error, :unsupported_version}

  defp check_contract_id(%{contract_id: id}) when is_binary(id) and byte_size(id) > 0, do: :ok
  defp check_contract_id(_), do: {:error, :invalid_contract_id}

  defp check_revision(%{revision: rev}) when is_integer(rev) and rev >= 1, do: :ok
  defp check_revision(_), do: {:error, :invalid_revision}

  defp check_identity(%{project_slug: p, issue_identifier: i, server_slug: s})
       when is_binary(p) and byte_size(p) > 0 and is_binary(i) and byte_size(i) > 0 and
              is_binary(s) and byte_size(s) > 0,
       do: :ok

  defp check_identity(_), do: {:error, :invalid_identity}

  defp check_source(%{source: source}) when source in @sources, do: :ok
  defp check_source(_), do: {:error, :invalid_source}

  defp check_preferred_port(%{preferred_port: port}) when is_integer(port) and port in @min_port..@max_port,
    do: :ok

  defp check_preferred_port(_), do: {:error, :invalid_preferred_port}

  defp check_allowed_ports(%{allowed_ports: allowed, preferred_port: preferred}) do
    cond do
      allowed == [] -> {:error, :invalid_allowed_ports}
      not Enum.all?(allowed, &(is_integer(&1) and &1 in @min_port..@max_port)) -> {:error, :invalid_allowed_ports}
      preferred not in allowed -> {:error, :preferred_not_allowed}
      length(Enum.uniq(allowed)) != length(allowed) -> {:error, :invalid_allowed_ports}
      true -> :ok
    end
  end

  defp check_report_path(%{report_path: path}) when is_binary(path) and byte_size(path) > 0, do: :ok
  defp check_report_path(_), do: {:error, :invalid_report_path}

  defp check_probe(%{ready_probe: probe}) when probe in @ready_probes, do: :ok
  defp check_probe(_), do: {:error, :invalid_ready_probe}

  defp check_port_env(%{port_env: env}) when is_binary(env) and byte_size(env) > 0, do: :ok
  defp check_port_env(_), do: {:error, :invalid_port_env}

  defp check_expiry(%{expires_at: %DateTime{}}), do: :ok
  defp check_expiry(_), do: {:error, :invalid_expiry}

  defp fetch(attrs, key, default) do
    case Map.fetch(attrs, key) do
      {:ok, value} ->
        value

      :error ->
        case Map.fetch(attrs, Atom.to_string(key)) do
          {:ok, value} -> value
          :error -> default
        end
    end
  end
end
