defmodule SymphonyElixirWeb.Tracker.ProjectGatewayController do
  @moduledoc "Per-project external gateway configuration endpoints."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.Binding
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Settings
  alias SymphonyElixirWeb.TrackerErrors

  @spec show_telegram(Conn.t(), map()) :: Conn.t()
  def show_telegram(conn, %{"project_slug" => project_slug}) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      json(conn, %{data: project_gateway_payload(project_slug)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec telegram_pairing_code(Conn.t(), map()) :: Conn.t()
  def telegram_pairing_code(conn, %{"project_slug" => project_slug}) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, pairing_code} <- Gateways.create_pairing_code(:project_topic, %{project_slug: project_slug}) do
      json(conn, %{data: %{code: pairing_code.code, command: "/symphony_pair #{pairing_code.code}"}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec reset_telegram(Conn.t(), map()) :: Conn.t()
  def reset_telegram(conn, %{"project_slug" => project_slug}) do
    with {:ok, binding} <- Gateways.get_active_project_topic_binding("telegram", project_slug),
         :ok <- archive_active_thread(binding),
         {:ok, _binding} <- Gateways.clear_active_thread(binding) do
      json(conn, %{data: project_gateway_payload(project_slug)})
    else
      {:error, :binding_not_found} -> TrackerErrors.render(conn, :not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete_telegram(Conn.t(), map()) :: Conn.t()
  def delete_telegram(conn, %{"project_slug" => project_slug}) do
    with {:ok, binding} <- Gateways.get_active_project_topic_binding("telegram", project_slug),
         {:ok, archived} <- Gateways.update_binding(binding, %{status: "archived"}) do
      json(conn, %{data: %{binding: present_binding(archived), globalConfigured: global_configured?()}})
    else
      {:error, :binding_not_found} -> TrackerErrors.render(conn, :not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp project_gateway_payload(project_slug) do
    binding =
      case Gateways.get_active_project_topic_binding("telegram", project_slug) do
        {:ok, %Binding{} = binding} -> present_binding(binding)
        {:error, :binding_not_found} -> nil
      end

    %{binding: binding, globalConfigured: global_configured?()}
  end

  defp present_binding(%Binding{} = binding) do
    %{
      id: binding.id,
      projectSlug: binding.project_slug,
      conversationId: binding.conversation_id,
      threadId: binding.thread_id,
      status: binding.status,
      defaultAgentKind: binding.default_agent_kind,
      defaultMode: binding.default_mode,
      activeMode: binding.active_mode,
      activeThreadId: binding.active_thread_id
    }
  end

  defp global_configured? do
    Settings.get("gateways", "telegram_enabled") == true and is_binary(Settings.get("gateways", "telegram_group_chat_id"))
  end

  defp archive_active_thread(%Binding{active_thread_id: id}) when is_integer(id) do
    case History.archive_thread(id) do
      {:ok, _thread} -> :ok
      {:error, :not_found} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp archive_active_thread(_binding), do: :ok
end
