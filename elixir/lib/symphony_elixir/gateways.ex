defmodule SymphonyElixir.Gateways do
  @moduledoc "Persistence and lifecycle context for external chat gateways."

  import Ecto.Query

  alias SymphonyElixir.Gateways.{Binding, PairingCode}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings

  @default_account_id "default"
  @default_pairing_ttl_seconds 15 * 60

  @spec upsert_project_topic_binding(map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
  def upsert_project_topic_binding(attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("binding_kind", "project_topic")
      |> Map.put_new("account_id", @default_account_id)
      |> Map.put_new("status", "active")
      |> Map.put_new("active_mode", Map.get(attrs, :default_mode) || Map.get(attrs, "default_mode") || "explore")
      |> Map.put_new("metadata", %{})

    case active_project_topic(attrs["provider"], attrs["project_slug"]) do
      %Binding{} = binding -> update_binding(binding, attrs)
      nil -> insert_binding(attrs)
    end
  end

  @spec ensure_direct_freeform_binding(map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
  def ensure_direct_freeform_binding(attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("binding_kind", "direct_freeform")
      |> Map.put_new("account_id", @default_account_id)
      |> Map.put_new("status", "active")
      |> Map.put("default_mode", "freeform")
      |> Map.put("active_mode", "freeform")
      |> Map.put_new("default_agent_kind", Settings.Agents.default_agent_kind())
      |> Map.put_new("metadata", %{})

    case active_direct_binding(attrs["provider"], attrs["account_id"], attrs["sender_id"]) do
      %Binding{} = binding -> {:ok, binding}
      nil -> insert_binding(attrs)
    end
  end

  @spec ensure_group_freeform_binding(map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
  def ensure_group_freeform_binding(attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("binding_kind", "group_freeform")
      |> Map.put_new("account_id", @default_account_id)
      |> Map.put_new("status", "active")
      |> Map.put("default_mode", "freeform")
      |> Map.put("active_mode", "freeform")
      |> Map.put_new("default_agent_kind", Settings.Agents.default_agent_kind())
      |> Map.put_new("metadata", %{})

    case get_active_binding(attrs["provider"], attrs["account_id"], attrs["conversation_id"]) do
      {:ok, %Binding{binding_kind: "group_freeform"} = binding} -> {:ok, binding}
      {:ok, %Binding{} = other} -> {:error, {:unexpected_binding_kind, other.binding_kind}}
      {:error, :binding_not_found} -> insert_binding(attrs)
    end
  end

  @spec get_active_binding(String.t(), String.t(), String.t()) :: {:ok, Binding.t()} | {:error, :binding_not_found}
  def get_active_binding(provider, account_id, conversation_id)
      when is_binary(provider) and is_binary(account_id) and is_binary(conversation_id) do
    case Repo.get_by(Binding,
           provider: String.trim(provider),
           account_id: String.trim(account_id),
           conversation_id: String.trim(conversation_id),
           status: "active"
         ) do
      %Binding{} = binding -> {:ok, binding}
      nil -> {:error, :binding_not_found}
    end
  end

  @spec get_active_project_topic_binding(String.t(), String.t()) :: {:ok, Binding.t()} | {:error, :binding_not_found}
  def get_active_project_topic_binding(provider, project_slug) when is_binary(provider) and is_binary(project_slug) do
    case active_project_topic(provider, project_slug) do
      %Binding{} = binding -> {:ok, binding}
      nil -> {:error, :binding_not_found}
    end
  end

  @spec update_binding(Binding.t(), map()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
  def update_binding(%Binding{} = binding, attrs) when is_map(attrs) do
    binding
    |> Binding.changeset(stringify_keys(attrs))
    |> Repo.update()
  end

  @spec clear_active_thread(Binding.t()) :: {:ok, Binding.t()} | {:error, Ecto.Changeset.t()}
  def clear_active_thread(%Binding{} = binding), do: update_binding(binding, %{"active_thread_id" => nil})

  @spec create_pairing_code(atom(), map(), keyword()) :: {:ok, PairingCode.t()} | {:error, Ecto.Changeset.t()}
  def create_pairing_code(purpose, payload, opts \\ []) when is_atom(purpose) and is_map(payload) and is_list(opts) do
    ttl_seconds = Keyword.get(opts, :ttl_seconds, @default_pairing_ttl_seconds)

    attrs = %{
      code: generate_pairing_code(),
      purpose: Atom.to_string(purpose),
      payload: stringify_keys(payload),
      expires_at: DateTime.utc_now() |> DateTime.add(ttl_seconds, :second) |> DateTime.truncate(:microsecond)
    }

    %PairingCode{}
    |> PairingCode.changeset(attrs)
    |> Repo.insert()
  end

  @spec consume_pairing_code(String.t(), atom()) ::
          {:ok, map()} | {:error, :pairing_code_not_found | :pairing_code_expired}
  def consume_pairing_code(code, purpose) when is_binary(code) and is_atom(purpose) do
    pairing_code =
      Repo.one(
        from(p in PairingCode,
          where:
            p.code == ^String.trim(code) and p.purpose == ^Atom.to_string(purpose) and
              is_nil(p.consumed_at)
        )
      )

    case pairing_code do
      %PairingCode{} = pairing_code ->
        if DateTime.compare(pairing_code.expires_at, DateTime.utc_now()) == :lt do
          {:error, :pairing_code_expired}
        else
          payload = atomize_payload(pairing_code.payload || %{})
          Repo.delete(pairing_code)
          {:ok, payload}
        end

      nil ->
        {:error, :pairing_code_not_found}
    end
  end

  defp insert_binding(attrs) do
    %Binding{}
    |> Binding.changeset(attrs)
    |> Repo.insert()
  end

  defp active_project_topic(provider, project_slug) when is_binary(provider) and is_binary(project_slug) do
    Repo.one(
      from(b in Binding,
        where:
          b.provider == ^String.trim(provider) and b.project_slug == ^String.trim(project_slug) and
            b.binding_kind == "project_topic" and b.status == "active"
      )
    )
  end

  defp active_project_topic(_provider, _project_slug), do: nil

  defp active_direct_binding(provider, account_id, sender_id)
       when is_binary(provider) and is_binary(account_id) and is_binary(sender_id) do
    Repo.one(
      from(b in Binding,
        where:
          b.provider == ^String.trim(provider) and b.account_id == ^String.trim(account_id) and
            b.sender_id == ^String.trim(sender_id) and b.binding_kind == "direct_freeform" and b.status == "active"
      )
    )
  end

  defp active_direct_binding(_provider, _account_id, _sender_id), do: nil

  defp stringify_keys(map) do
    Map.new(map, fn {key, value} -> {to_string(key), value} end)
  end

  defp atomize_payload(map) do
    Map.new(map, fn {key, value} -> {String.to_existing_atom(key), value} end)
  rescue
    ArgumentError -> map
  end

  defp generate_pairing_code do
    :crypto.strong_rand_bytes(6)
    |> Base.url_encode64(padding: false)
  end
end
