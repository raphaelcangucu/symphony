defmodule SymphonyElixir.Gateways.SessionResolver do
  @moduledoc "Resolves gateway bindings to durable Symphony assistant threads."

  alias SymphonyElixir.Assistant.{CodexSession, History, Thread}
  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Gateways.Binding

  @spec ensure_thread(Binding.t()) :: {:ok, Thread.t(), Binding.t()} | {:error, term()}
  def ensure_thread(%Binding{} = binding) do
    with :error <- active_thread(binding),
         {:ok, thread} <- create_thread(binding),
         {:ok, updated_binding} <- Gateways.update_binding(binding, %{active_thread_id: thread.id}) do
      {:ok, thread, updated_binding}
    else
      {:ok, %Thread{} = thread} -> {:ok, thread, binding}
      {:error, reason} -> {:error, reason}
    end
  end

  defp active_thread(%Binding{active_thread_id: id}) when is_integer(id) do
    case History.get_thread(id) do
      {:ok, %Thread{status: "active"} = thread} -> {:ok, thread}
      _other -> :error
    end
  end

  defp active_thread(_binding), do: :error

  defp create_thread(%Binding{binding_kind: "direct_freeform"} = binding) do
    History.create_gateway_freeform_thread(%{
      workspace_path: CodexSession.freeform_workspace(binding.id),
      title: "Telegram DM #{binding.sender_id}",
      agent_kind: binding.default_agent_kind,
      metadata: %{
        "gateway_binding_id" => binding.id,
        "gateway_provider" => binding.provider,
        "gateway_conversation_id" => binding.conversation_id
      }
    })
  end

  defp create_thread(%Binding{binding_kind: "project_topic", active_mode: "explore"} = binding) do
    with {:ok, thread} <-
           History.ensure_project_explore_thread(binding.project_slug, %{
             title: "Telegram topic #{binding.thread_id}",
             agent_kind: binding.default_agent_kind,
             metadata: %{
               "gateway_binding_id" => binding.id,
               "gateway_provider" => binding.provider,
               "gateway_conversation_id" => binding.conversation_id,
               "gateway_thread_id" => binding.thread_id
             }
           }) do
      maybe_set_thread_agent(thread, binding.default_agent_kind)
    end
  end

  defp create_thread(%Binding{binding_kind: "project_topic", active_mode: "project"} = binding) do
    History.ensure_thread(binding.project_slug, %{
      agent_kind: binding.default_agent_kind,
      metadata: %{"gateway_binding_id" => binding.id}
    })
  end

  defp create_thread(%Binding{binding_kind: "project_topic", active_mode: "issue", active_issue_identifier: identifier} = binding)
       when is_binary(identifier) and identifier != "" do
    History.ensure_issue_thread(binding.project_slug, identifier, %{
      agent_kind: binding.default_agent_kind,
      metadata: %{"gateway_binding_id" => binding.id}
    })
  end

  defp create_thread(
         %Binding{
           binding_kind: "project_topic",
           active_mode: "kb",
           active_kb_repo_slug: repo_slug,
           active_kb_page_path: page_path
         } = binding
       )
       when is_binary(repo_slug) and repo_slug != "" and is_binary(page_path) and page_path != "" do
    History.ensure_kb_thread(binding.project_slug, repo_slug, page_path, %{
      agent_kind: binding.default_agent_kind,
      metadata: %{"gateway_binding_id" => binding.id}
    })
  end

  defp create_thread(%Binding{active_mode: mode}), do: {:error, {:unsupported_gateway_mode, mode}}

  defp maybe_set_thread_agent(thread, kind) when kind in ["codex", "claude", "cursor", "opencode"] do
    History.set_thread_agent(thread, kind)
  end

  defp maybe_set_thread_agent(thread, _kind), do: {:ok, thread}
end
