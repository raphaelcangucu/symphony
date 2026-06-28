defmodule SymphonyElixir.Gateways.Router do
  @moduledoc "Routes normalized gateway messages through access control, commands, and assistant sessions."

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Assistant.CodexSession
  alias SymphonyElixir.Gateways.{Binding, CommandParser, InboundMessage, SessionResolver}
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Gateways, as: GatewaySettings

  @spec handle_message(InboundMessage.t(), keyword()) ::
          {:ok, :command | :queued | :sent} | {:dropped, atom()} | {:error, term()}
  def handle_message(%InboundMessage{} = message, opts \\ []) when is_list(opts) do
    adapter = Keyword.get(opts, :adapter, SymphonyElixir.Gateways.TelegramAdapter)
    parsed = CommandParser.parse(message.raw_text)

    with :continue <- maybe_handle_pairing_command(parsed, message, adapter),
         :ok <- ensure_gateway_enabled(message, parsed),
         {:ok, binding} <- resolve_or_create_binding(message) do
      case parsed do
        :plain_text ->
          dispatch_plain_text(binding, message, adapter, opts)

        {:command, command} ->
          execute_command(command, binding, message, adapter)

        {:error, reason} ->
          send_text(adapter, message, command_error_text(reason))
          {:ok, :command}
      end
    end
  end

  defp ensure_gateway_enabled(%InboundMessage{}, parsed) do
    case {GatewaySettings.telegram_enabled?(), parsed} do
      {true, _parsed} -> :ok
      {false, {:command, {:setup_pair, _payload}}} -> :ok
      {false, _parsed} -> {:dropped, :gateway_disabled}
    end
  end

  defp maybe_handle_pairing_command({:command, {:setup_pair, %{code: code}}}, message, adapter) do
    with {:ok, _payload} <- Gateways.consume_pairing_code(code, :setup),
         {:ok, group_id} <- setup_group_id(message),
         {:ok, _group_id} <- Settings.put("gateways", "telegram_group_chat_id", group_id) do
      send_text(adapter, message, "Telegram group paired with Symphony.")
      {:ok, :command}
    end
  end

  defp maybe_handle_pairing_command({:command, {:project_pair, %{code: code}}}, message, adapter) do
    with :ok <- ensure_topic_message(message),
         :ok <- ensure_group_matches_settings(message),
         {:ok, %{project_slug: project_slug}} <- Gateways.consume_pairing_code(code, :project_topic),
         {:ok, binding} <- create_project_topic_binding(message, project_slug) do
      send_text(adapter, message, "Project #{binding.project_slug} paired to topic #{binding.thread_id}.")
      {:ok, :command}
    end
  end

  defp maybe_handle_pairing_command(_parsed, _message, _adapter), do: :continue

  defp setup_group_id(%InboundMessage{conversation_kind: "group", conversation_id: conversation_id})
       when is_binary(conversation_id),
       do: {:ok, conversation_id}

  defp setup_group_id(%InboundMessage{conversation_kind: "topic", parent_conversation_id: parent_id})
       when is_binary(parent_id),
       do: {:ok, parent_id}

  defp setup_group_id(_message), do: {:error, :telegram_group_required}

  defp ensure_topic_message(%InboundMessage{conversation_kind: "topic", parent_conversation_id: parent_id, thread_id: thread_id})
       when is_binary(parent_id) and is_binary(thread_id),
       do: :ok

  defp ensure_topic_message(_message), do: {:error, :telegram_topic_required}

  defp ensure_group_matches_settings(%InboundMessage{parent_conversation_id: parent_id}) do
    if parent_id == GatewaySettings.telegram_group_chat_id(), do: :ok, else: {:dropped, :unauthorized_group}
  end

  defp create_project_topic_binding(message, project_slug) do
    Gateways.upsert_project_topic_binding(%{
      provider: message.provider,
      account_id: message.account_id,
      project_slug: project_slug,
      conversation_id: message.conversation_id,
      parent_conversation_id: message.parent_conversation_id,
      thread_id: message.thread_id,
      default_agent_kind: Settings.Agents.default_agent_kind(),
      default_mode: "explore"
    })
  end

  defp resolve_or_create_binding(%InboundMessage{conversation_kind: "direct"} = message) do
    if allowed_sender?(message.sender_id, GatewaySettings.telegram_dm_allowed_user_ids()) do
      Gateways.ensure_direct_freeform_binding(%{
        provider: message.provider,
        account_id: message.account_id,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id
      })
    else
      {:dropped, :unauthorized_direct_sender}
    end
  end

  defp resolve_or_create_binding(%InboundMessage{conversation_kind: "topic"} = message) do
    cond do
      message.parent_conversation_id != GatewaySettings.telegram_group_chat_id() ->
        {:dropped, :unauthorized_group}

      not allowed_sender?(message.sender_id, GatewaySettings.telegram_allowed_user_ids()) ->
        {:dropped, :unauthorized_group_sender}

      true ->
        Gateways.get_active_binding(message.provider, message.account_id, message.conversation_id)
    end
  end

  defp resolve_or_create_binding(%InboundMessage{conversation_kind: "group"} = message) do
    if message.conversation_id == GatewaySettings.telegram_group_chat_id() do
      {:error, :group_topic_required}
    else
      {:dropped, :unauthorized_group}
    end
  end

  defp execute_command({:help, %{}}, _binding, message, adapter) do
    send_text(adapter, message, "Commands: /status, /agent <codex|claude|cursor>, /mode, /new, /stop")
    {:ok, :command}
  end

  defp execute_command({:status, %{}}, binding, message, adapter) do
    send_text(adapter, message, status_text(binding))
    {:ok, :command}
  end

  defp execute_command({:show_agent, %{}}, %Binding{} = binding, message, adapter) do
    send_text(adapter, message, "Current agent: #{binding.default_agent_kind || "default"}")
    {:ok, :command}
  end

  defp execute_command({:set_agent, %{agent_kind: agent_kind}}, %Binding{} = binding, message, adapter) do
    with {:ok, updated} <- Gateways.update_binding(binding, %{default_agent_kind: agent_kind}) do
      send_text(adapter, message, "Agent set to #{updated.default_agent_kind}.")
      {:ok, :command}
    end
  end

  defp execute_command({:show_mode, %{}}, %Binding{} = binding, message, adapter) do
    send_text(adapter, message, "Current mode: #{binding.active_mode}.")
    {:ok, :command}
  end

  defp execute_command({:set_mode, %{mode: "freeform"}}, %Binding{binding_kind: "direct_freeform"} = binding, message, adapter) do
    with {:ok, updated} <- Gateways.update_binding(binding, %{active_mode: "freeform", default_mode: "freeform"}) do
      send_text(adapter, message, "Mode set to #{updated.active_mode}.")
      {:ok, :command}
    end
  end

  defp execute_command({:set_mode, %{mode: mode}}, %Binding{binding_kind: "direct_freeform"}, message, adapter)
       when mode in ["explore", "project", "issue", "kb"] do
    send_text(adapter, message, "Mode #{mode} requires a paired project topic.")
    {:ok, :command}
  end

  defp execute_command({:set_mode, %{mode: mode}}, %Binding{binding_kind: "project_topic"} = binding, message, adapter) do
    with {:ok, updated} <- Gateways.update_binding(binding, %{active_mode: mode, default_mode: mode}) do
      send_text(adapter, message, "Mode set to #{updated.active_mode}.")
      {:ok, :command}
    end
  end

  defp execute_command({:new_session, %{}}, binding, message, adapter) do
    with {:ok, _updated} <- Gateways.clear_active_thread(binding) do
      send_text(adapter, message, "Started a new session for this conversation.")
      {:ok, :command}
    end
  end

  defp execute_command({:stop, %{}}, _binding, message, adapter) do
    send_text(adapter, message, "No active turn.")
    {:ok, :command}
  end

  defp execute_command({:setup, %{}}, _binding, message, adapter) do
    send_text(adapter, message, "Use /symphony_setup <code> in the Telegram group or /symphony_pair <code> in a project topic.")
    {:ok, :command}
  end

  defp execute_command({_command, _payload}, _binding, message, adapter) do
    send_text(adapter, message, "Command accepted.")
    {:ok, :command}
  end

  defp dispatch_plain_text(%Binding{} = binding, %InboundMessage{} = message, adapter, opts) do
    with {:ok, thread, updated_binding} <- SessionResolver.ensure_thread(binding),
         :ok <- adapter.send_typing(message, []),
         {:ok, result} <- run_assistant_turn(thread, updated_binding, message, opts),
         :ok <- send_text(adapter, message, Map.fetch!(result, :assistant_message)) do
      {:ok, :sent}
    end
  end

  defp run_assistant_turn(%{scope: "freeform"} = thread, binding, message, opts) do
    CodexSession.send_message_to_thread(thread, message.raw_text, gateway_context(binding, message), runner_opts(binding, opts))
  end

  defp run_assistant_turn(%{scope: "project_explore"} = thread, binding, message, opts) do
    CodexSession.send_message_to_project_explore_thread(thread, message.raw_text, gateway_context(binding, message), runner_opts(binding, opts))
  end

  defp run_assistant_turn(%{scope: "project"} = thread, binding, message, opts) do
    CodexSession.send_message_to_thread(thread, message.raw_text, gateway_context(binding, message), runner_opts(binding, opts))
  end

  defp run_assistant_turn(%{scope: "issue"} = thread, binding, message, opts) do
    CodexSession.send_message_to_issue_thread(thread, message.raw_text, gateway_context(binding, message), runner_opts(binding, opts))
  end

  defp run_assistant_turn(%{scope: "kb"} = thread, binding, message, opts) do
    CodexSession.send_message_to_kb_thread(thread, message.raw_text, gateway_context(binding, message), runner_opts(binding, opts))
  end

  defp gateway_context(binding, message) do
    %{
      "source" => "telegram",
      "provider" => message.provider,
      "conversation_id" => message.conversation_id,
      "conversation_kind" => message.conversation_kind,
      "sender_id" => message.sender_id,
      "message_id" => message.message_id,
      "agent" => binding.default_agent_kind
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp runner_opts(binding, opts) do
    []
    |> maybe_put_runner(opts)
    |> Keyword.put(:agent_kind, binding.default_agent_kind)
  end

  defp maybe_put_runner(opts, source_opts) do
    case Keyword.fetch(source_opts, :runner) do
      {:ok, runner} -> Keyword.put(opts, :runner, runner)
      :error -> opts
    end
  end

  defp send_text(adapter, message, text), do: adapter.send_text(message, text, [])

  defp status_text(%Binding{} = binding) do
    "Gateway status: #{binding.binding_kind}; mode=#{binding.active_mode}; agent=#{binding.default_agent_kind || "default"}."
  end

  defp command_error_text(:unknown_command), do: "Unknown command. Use /help."
  defp command_error_text(:invalid_agent), do: "Invalid agent. Use codex, claude, or cursor."
  defp command_error_text(:missing_mode), do: "Missing mode. Use /mode explore, project, issue, kb, or freeform."
  defp command_error_text(_reason), do: "Invalid command. Use /help."

  defp allowed_sender?(sender_id, allowed_ids) when is_binary(sender_id) and is_list(allowed_ids) do
    sender_id in allowed_ids
  end

  defp allowed_sender?(_sender_id, _allowed_ids), do: false
end
