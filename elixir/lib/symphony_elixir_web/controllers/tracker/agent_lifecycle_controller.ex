defmodule SymphonyElixirWeb.Tracker.AgentLifecycleController do
  @moduledoc "Managed CLI lifecycle, isolated accounts, and per-account usage."

  use Phoenix.Controller, formats: [:json]

  alias SymphonyElixir.AgentAccounts
  alias SymphonyElixir.AgentLifecycle.{Catalog, Installer}
  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.AgentCli

  def source(conn, %{"agent" => agent, "source" => source})
      when source in ["managed", "path"] do
    with :ok <- known_agent(agent),
         {:ok, settings} <- update_cli(agent, "preferred_source", source) do
      json(conn, %{data: settings})
    else
      error -> render_error(conn, error)
    end
  end

  def source(conn, %{"agent" => agent}) do
    with :ok <- known_agent(agent) do
      validation_error(conn, "source must be managed or path")
    else
      error -> render_error(conn, error)
    end
  end

  def install(conn, params), do: run_install(conn, params, "install")
  def update(conn, params), do: run_install(conn, params, "update")
  def repair(conn, params), do: run_install(conn, params, "repair")

  def accounts(conn, %{"agent" => agent}) do
    with :ok <- known_agent(agent),
         {:ok, accounts} <- AgentAccounts.list(agent) do
      json(conn, %{data: %{accounts: Enum.map(accounts, &present_account(agent, &1))}})
    else
      error -> render_error(conn, error)
    end
  end

  def create_account(conn, %{"agent" => agent} = params) do
    attrs =
      params
      |> Map.take(["id", "label", "authentication_status"])
      |> Map.put_new("authentication_status", "unauthenticated")

    with :ok <- known_agent(agent),
         {:ok, account} <- AgentAccounts.create(agent, attrs) do
      conn
      |> put_status(:created)
      |> json(%{data: present_account(agent, account)})
    else
      error -> render_error(conn, error)
    end
  end

  def update_account(conn, %{"agent" => agent, "id" => id} = params) do
    attrs = Map.take(params, ["label", "authentication_status"])

    with :ok <- known_agent(agent),
         {:ok, account} <- AgentAccounts.update(agent, id, attrs) do
      json(conn, %{data: present_account(agent, account)})
    else
      error -> render_error(conn, error)
    end
  end

  def delete_account(conn, %{"agent" => agent, "id" => id}) do
    with :ok <- known_agent(agent),
         :ok <- AgentAccounts.delete(agent, id) do
      send_resp(conn, :no_content, "")
    else
      error -> render_error(conn, error)
    end
  end

  def default_account(conn, %{"agent" => agent, "id" => id}) do
    with :ok <- known_agent(agent),
         {:ok, account} <- AgentAccounts.set_default(agent, id) do
      json(conn, %{data: present_account(agent, account)})
    else
      error -> render_error(conn, error)
    end
  end

  def failover(conn, %{"agent" => agent, "enabled" => enabled})
      when is_boolean(enabled) do
    with :ok <- known_agent(agent),
         {:ok, settings} <- update_cli(agent, "failover_enabled", enabled) do
      json(conn, %{data: settings})
    else
      error -> render_error(conn, error)
    end
  end

  def failover(conn, %{"agent" => agent}) do
    with :ok <- known_agent(agent) do
      validation_error(conn, "enabled must be a boolean")
    else
      error -> render_error(conn, error)
    end
  end

  defp run_install(conn, %{"agent" => agent}, operation) do
    with :ok <- known_agent(agent),
         {:ok, result} <- installer().install_latest(agent, []) do
      json(conn, %{
        data:
          result
          |> Map.take([:status, :version, :executable_path])
          |> Map.put(:operation, operation)
      })
    else
      error -> render_error(conn, error)
    end
  end

  defp update_cli(agent, key, value) do
    settings = AgentCli.for(agent) |> Map.put(key, value)

    case Settings.put("agent_cli", agent, settings) do
      {:ok, stored} -> {:ok, stored}
      {:error, reason} -> {:error, reason}
    end
  end

  defp present_account(agent, account) do
    account
    |> AgentAccounts.present()
    |> Map.put(:usage, present_usage(AgentUsage.entry(agent, account.id)))
  end

  defp present_usage(%{snapshot: nil}), do: nil

  defp present_usage(%{snapshot: snapshot} = entry) do
    %{
      account_id: snapshot.account_id,
      plan: snapshot.plan,
      credits_remaining: snapshot.credits_remaining,
      fetched_at: snapshot.fetched_at,
      state: entry.state,
      stale: entry.stale,
      stale_reason: entry.stale_reason,
      next_refresh_at: entry.next_refresh_at,
      windows:
        Enum.map(snapshot.windows, fn window ->
          %{
            kind: window.kind,
            used_percent: window.used_percent,
            resets_at: window.resets_at,
            window_minutes: window.window_minutes
          }
        end)
    }
  end

  defp known_agent(agent) do
    if agent in Catalog.kinds(), do: :ok, else: {:error, :agent_not_found}
  end

  defp installer,
    do: Application.get_env(:symphony_elixir, :agent_installer, Installer)

  defp render_error(conn, {:error, reason}), do: render_error(conn, reason)

  defp render_error(conn, :agent_not_found),
    do: error(conn, :not_found, "agent_not_found", "Agent not found")

  defp render_error(conn, {:account_not_found, _id}),
    do: error(conn, :not_found, "account_not_found", "Account not found")

  defp render_error(conn, reason),
    do: validation_error(conn, inspect(reason))

  defp validation_error(conn, message),
    do: error(conn, :unprocessable_entity, "validation_failed", message)

  defp error(conn, status, code, message) do
    conn
    |> put_status(status)
    |> json(%{error: %{code: code, message: message}})
  end
end
