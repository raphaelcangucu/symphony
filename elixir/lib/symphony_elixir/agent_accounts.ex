defmodule SymphonyElixir.AgentAccounts do
  @moduledoc """
  Metadata and selection for isolated provider accounts.

  Credentials stay in provider-owned files below each account home. The JSON
  manifest contains only operator-safe metadata and is replaced atomically.
  """

  alias SymphonyElixir.AgentLifecycle.{Catalog, Paths}

  @statuses ~w(authenticated unauthenticated expired error)

  @spec create(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def create(agent, attrs) when is_binary(agent) and is_map(attrs) do
    transaction(agent, fn ->
      with {:ok, _catalog} <- Catalog.fetch(agent),
           {:ok, id} <- required(attrs, :id),
           {:ok, label} <- required(attrs, :label),
           {:ok, status} <- authentication_status(attrs),
           {:ok, accounts} <- list(agent),
           false <- Enum.any?(accounts, &(&1.id == id)),
           home <- Paths.account_home(agent, id),
           :ok <- File.mkdir_p(home) do
        now = System.system_time(:millisecond)

        account = %{
          id: id,
          label: label,
          agent_kind: agent,
          home: home,
          authentication_status: status,
          default: false,
          created_at: now,
          updated_at: now
        }

        with :ok <- persist(agent, accounts ++ [account]) do
          {:ok, account}
        end
      else
        true -> {:error, {:account_exists, value(attrs, :id)}}
        :error -> {:error, :unknown_agent}
        {:error, _reason} = error -> error
      end
    end)
  end

  @spec list(String.t()) :: {:ok, [map()]} | {:error, term()}
  def list(agent) when is_binary(agent) do
    path = Paths.accounts_manifest(agent)

    case File.read(path) do
      {:ok, contents} ->
        with {:ok, %{"accounts" => accounts}} when is_list(accounts) <- Jason.decode(contents) do
          {:ok, Enum.map(accounts, &from_record(agent, &1))}
        else
          _ -> {:error, :invalid_accounts_manifest}
        end

      {:error, :enoent} ->
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec set_default(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def set_default(agent, id) when is_binary(agent) and is_binary(id) do
    transaction(agent, fn ->
      with {:ok, accounts} <- list(agent),
           %{} = selected <- Enum.find(accounts, &(&1.id == id)),
           true <- eligible?(selected) || {:error, {:account_not_eligible, id}} do
        now = System.system_time(:millisecond)

        updated =
          Enum.map(accounts, fn account ->
            %{account | default: account.id == id, updated_at: now}
          end)

        with :ok <- persist(agent, updated) do
          {:ok, Enum.find(updated, &(&1.id == id))}
        end
      else
        nil -> {:error, {:account_not_found, id}}
        {:error, _reason} = error -> error
      end
    end)
  end

  @spec update(String.t(), String.t(), map()) :: {:ok, map()} | {:error, term()}
  def update(agent, id, attrs)
      when is_binary(agent) and is_binary(id) and is_map(attrs) do
    transaction(agent, fn ->
      with {:ok, accounts} <- list(agent),
           %{} = selected <- Enum.find(accounts, &(&1.id == id)),
           {:ok, label} <- optional_label(attrs, selected.label),
           {:ok, status} <-
             optional_authentication_status(attrs, selected.authentication_status) do
        updated_account = %{
          selected
          | label: label,
            authentication_status: status,
            updated_at: System.system_time(:millisecond)
        }

        updated =
          Enum.map(accounts, fn
            %{id: ^id} -> updated_account
            account -> account
          end)

        with :ok <- persist(agent, updated), do: {:ok, updated_account}
      else
        nil -> {:error, {:account_not_found, id}}
        {:error, _reason} = error -> error
      end
    end)
  end

  @spec delete(String.t(), String.t()) :: :ok | {:error, term()}
  def delete(agent, id) when is_binary(agent) and is_binary(id) do
    transaction(agent, fn ->
      with {:ok, accounts} <- list(agent),
           %{} <- Enum.find(accounts, &(&1.id == id)),
           :ok <- persist(agent, Enum.reject(accounts, &(&1.id == id))) do
        case File.rm_rf(Paths.account_home(agent, id)) do
          {:ok, _removed} -> :ok
          {:error, reason, _path} -> {:error, reason}
        end
      else
        nil -> {:error, {:account_not_found, id}}
        {:error, _reason} = error -> error
      end
    end)
  end

  @doc """
  Resolves request, project, global default, then first authenticated account.
  """
  @spec resolve(String.t(), String.t() | nil, String.t() | nil) :: {:ok, map()} | {:error, term()}
  def resolve(agent, project_override, request_override) do
    with {:ok, accounts} <- list(agent) do
      case request_override || project_override do
        id when is_binary(id) -> resolve_explicit(accounts, id)
        nil -> resolve_default(accounts)
      end
    end
  end

  @spec present(map()) :: map()
  def present(account) do
    Map.take(account, [
      :id,
      :label,
      :agent_kind,
      :authentication_status,
      :default,
      :created_at,
      :updated_at
    ])
  end

  defp resolve_explicit(accounts, id) do
    case Enum.find(accounts, &(&1.id == id)) do
      nil -> {:error, {:account_not_found, id}}
      account -> if eligible?(account), do: {:ok, account}, else: {:error, {:account_not_eligible, id}}
    end
  end

  defp resolve_default(accounts) do
    selected =
      Enum.find(accounts, &(&1.default && eligible?(&1))) ||
        Enum.find(accounts, &eligible?/1)

    if selected, do: {:ok, selected}, else: {:error, :no_authenticated_account}
  end

  defp eligible?(%{authentication_status: "authenticated"}), do: true
  defp eligible?(_account), do: false

  defp persist(agent, accounts) do
    path = Paths.accounts_manifest(agent)
    temporary = path <> ".tmp-#{System.unique_integer([:positive])}"
    payload = %{"accounts" => Enum.map(accounts, &to_record/1)}

    :ok = File.mkdir_p(Path.dirname(path))

    with :ok <- File.write(temporary, Jason.encode!(payload)),
         :ok <- File.rename(temporary, path) do
      :ok
    else
      {:error, reason} ->
        File.rm(temporary)
        {:error, reason}
    end
  end

  defp to_record(account) do
    account
    |> Map.take([
      :id,
      :label,
      :agent_kind,
      :authentication_status,
      :default,
      :created_at,
      :updated_at
    ])
    |> Map.new(fn {key, value} -> {Atom.to_string(key), value} end)
  end

  defp from_record(agent, record) do
    id = record["id"]

    %{
      id: id,
      label: record["label"],
      agent_kind: agent,
      home: Paths.account_home(agent, id),
      authentication_status: record["authentication_status"],
      default: record["default"] == true,
      created_at: record["created_at"],
      updated_at: record["updated_at"]
    }
  end

  defp required(attrs, key) do
    case value(attrs, key) do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, {:invalid_account, key}}
    end
  end

  defp authentication_status(attrs) do
    case value(attrs, :authentication_status) do
      status when status in @statuses -> {:ok, status}
      _ -> {:error, {:invalid_account, :authentication_status}}
    end
  end

  defp optional_label(attrs, fallback) do
    case value(attrs, :label) do
      nil -> {:ok, fallback}
      label when is_binary(label) and label != "" -> {:ok, label}
      _ -> {:error, {:invalid_account, :label}}
    end
  end

  defp optional_authentication_status(attrs, fallback) do
    case value(attrs, :authentication_status) do
      nil -> {:ok, fallback}
      status when status in @statuses -> {:ok, status}
      _ -> {:error, {:invalid_account, :authentication_status}}
    end
  end

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp transaction(agent, fun), do: :global.trans({__MODULE__, agent}, fun)
end
