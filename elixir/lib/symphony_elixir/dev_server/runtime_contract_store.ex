defmodule SymphonyElixir.DevServer.RuntimeContractStore do
  @moduledoc """
  DB-backed persistence for active preview runtime contracts.

  This module owns contract identity: `contract_id` is stable for the lifetime of
  a service's contract, and `revision` is monotonic. `put/2` is idempotent for an
  unchanged offer (same ports/paths) and rotates the revision only when the offer
  materially changes. It always returns the validated
  `SymphonyElixir.DevServer.RuntimeContract` domain struct so callers can
  serialize env and evaluate reports without re-reading the DB.
  """

  import Ecto.Query

  alias SymphonyElixir.DevServer.RuntimeContract
  alias SymphonyElixir.LocalTracker.PreviewRuntimeContract
  alias SymphonyElixir.Repo

  @default_ttl_ms 86_400_000

  @offer_fields [
    :source,
    :preferred_port,
    :allowed_ports,
    :report_path,
    :ready_probe,
    :ready_path,
    :url_path,
    :port_env
  ]

  @doc """
  Create or rotate the active contract for one issue service.

  `project` must expose `id` and `slug`. `attrs` must carry the offer fields
  (`issue_identifier`, `server_slug`, `source`, `preferred_port`,
  `allowed_ports`, `report_path`, `port_env`, and the optional probe/url paths).
  """
  @spec put(map(), map()) :: {:ok, RuntimeContract.t()} | {:error, term()}
  def put(%{id: project_id, slug: project_slug}, attrs)
      when is_integer(project_id) and is_binary(project_slug) and is_map(attrs) do
    issue_identifier = require_binary(attrs, :issue_identifier)
    server_slug = require_binary(attrs, :server_slug)

    with {:ok, issue_identifier} <- issue_identifier,
         {:ok, server_slug} <- server_slug do
      existing = fetch_record(project_id, issue_identifier, server_slug)
      offer = build_offer(attrs)

      cond do
        reusable?(existing, offer) ->
          to_domain(existing, project_slug)

        is_nil(existing) ->
          insert_new(project_id, project_slug, issue_identifier, server_slug, offer, attrs)

        true ->
          rotate(existing, project_slug, offer, attrs)
      end
    end
  end

  def put(_project, _attrs), do: {:error, :invalid_arguments}

  @spec get_active(map(), String.t(), String.t()) ::
          {:ok, RuntimeContract.t(), PreviewRuntimeContract.t()} | :error
  def get_active(%{id: project_id, slug: project_slug}, issue_identifier, server_slug)
      when is_integer(project_id) and is_binary(issue_identifier) and is_binary(server_slug) do
    case fetch_record(project_id, issue_identifier, server_slug) do
      nil ->
        :error

      record ->
        case to_domain(record, project_slug) do
          {:ok, contract} -> {:ok, contract, record}
          {:error, _reason} -> :error
        end
    end
  end

  def get_active(_project, _issue, _server), do: :error

  @spec list_for_issue(integer(), String.t()) :: [PreviewRuntimeContract.t()]
  def list_for_issue(project_id, issue_identifier)
      when is_integer(project_id) and is_binary(issue_identifier) do
    Repo.all(
      from(c in PreviewRuntimeContract,
        where: c.project_id == ^project_id and c.issue_identifier == ^issue_identifier
      )
    )
  end

  @spec delete_for_issue(integer(), String.t()) :: :ok
  def delete_for_issue(project_id, issue_identifier)
      when is_integer(project_id) and is_binary(issue_identifier) do
    Repo.delete_all(
      from(c in PreviewRuntimeContract,
        where: c.project_id == ^project_id and c.issue_identifier == ^issue_identifier
      )
    )

    :ok
  end

  @spec delete_for_server(integer(), String.t(), String.t()) :: :ok
  def delete_for_server(project_id, issue_identifier, server_slug)
      when is_integer(project_id) and is_binary(issue_identifier) and is_binary(server_slug) do
    Repo.delete_all(
      from(c in PreviewRuntimeContract,
        where:
          c.project_id == ^project_id and c.issue_identifier == ^issue_identifier and
            c.server_slug == ^server_slug
      )
    )

    :ok
  end

  @doc "Reconstruct the validated domain contract from a persisted record."
  @spec to_domain(PreviewRuntimeContract.t(), String.t()) ::
          {:ok, RuntimeContract.t()} | {:error, atom()}
  def to_domain(%PreviewRuntimeContract{} = record, project_slug) when is_binary(project_slug) do
    RuntimeContract.new(%{
      contract_id: record.contract_id,
      revision: record.revision,
      project_slug: project_slug,
      issue_identifier: record.issue_identifier,
      server_slug: record.server_slug,
      source: record.source,
      preferred_port: record.preferred_port,
      allowed_ports: record.allowed_ports,
      report_path: record.report_path,
      ready_probe: record.ready_probe,
      ready_path: record.ready_path,
      url_path: record.url_path,
      port_env: record.port_env,
      expires_at: record.expires_at
    })
  end

  defp insert_new(project_id, project_slug, issue_identifier, server_slug, offer, attrs) do
    attrs_map =
      offer
      |> Map.merge(%{
        project_id: project_id,
        issue_identifier: issue_identifier,
        server_slug: server_slug,
        contract_id: generate_contract_id(),
        revision: 1,
        expires_at: expires_at(attrs)
      })

    persist(%PreviewRuntimeContract{}, attrs_map, project_slug)
  end

  defp rotate(%PreviewRuntimeContract{} = existing, project_slug, offer, attrs) do
    attrs_map =
      offer
      |> Map.merge(%{revision: existing.revision + 1, expires_at: expires_at(attrs)})

    persist(existing, attrs_map, project_slug)
  end

  defp persist(struct, attrs_map, project_slug) do
    struct
    |> PreviewRuntimeContract.changeset(attrs_map)
    |> Repo.insert_or_update()
    |> case do
      {:ok, record} -> to_domain(record, project_slug)
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp reusable?(nil, _offer), do: false

  defp reusable?(%PreviewRuntimeContract{} = record, offer) do
    Enum.all?(@offer_fields, fn field ->
      normalize(Map.get(record, field)) == normalize(Map.get(offer, field))
    end)
  end

  defp normalize(value) when is_atom(value) and not is_nil(value), do: Atom.to_string(value)
  defp normalize(value), do: value

  defp build_offer(attrs) do
    %{
      source: to_source_string(fetch(attrs, :source, "managed")),
      preferred_port: fetch(attrs, :preferred_port, nil),
      allowed_ports: normalize_allowed(fetch(attrs, :allowed_ports, []), fetch(attrs, :preferred_port, nil)),
      report_path: fetch(attrs, :report_path, nil),
      ready_probe: fetch(attrs, :ready_probe, "tcp") || "tcp",
      ready_path: fetch(attrs, :ready_path, "/") || "/",
      url_path: fetch(attrs, :url_path, "/") || "/",
      port_env: fetch(attrs, :port_env, nil)
    }
  end

  defp normalize_allowed(allowed, preferred) when is_list(allowed) do
    [preferred | allowed]
    |> Enum.filter(&is_integer/1)
    |> Enum.uniq()
  end

  defp normalize_allowed(_allowed, _preferred), do: []

  defp to_source_string(source) when is_atom(source), do: Atom.to_string(source)
  defp to_source_string(source) when is_binary(source), do: source
  defp to_source_string(_source), do: "managed"

  defp fetch_record(project_id, issue_identifier, server_slug) do
    Repo.one(
      from(c in PreviewRuntimeContract,
        where:
          c.project_id == ^project_id and c.issue_identifier == ^issue_identifier and
            c.server_slug == ^server_slug
      )
    )
  end

  defp expires_at(attrs) do
    case fetch(attrs, :expires_at, nil) do
      %DateTime{} = value -> value
      _ -> DateTime.add(DateTime.utc_now(), ttl_ms(attrs), :millisecond)
    end
  end

  defp ttl_ms(attrs) do
    case fetch(attrs, :ttl_ms, nil) do
      ms when is_integer(ms) and ms > 0 -> ms
      _ -> @default_ttl_ms
    end
  end

  defp generate_contract_id do
    "ctr_" <> (Ecto.UUID.generate() |> String.replace("-", ""))
  end

  defp require_binary(attrs, key) do
    case fetch(attrs, key, nil) do
      value when is_binary(value) and byte_size(value) > 0 -> {:ok, value}
      _ -> {:error, {:missing, key}}
    end
  end

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
