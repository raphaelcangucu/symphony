defmodule SymphonyElixir.Agent.Error do
  @moduledoc """
  Stable error taxonomy shared by persistence, channels, and provider adapters.

  Raw provider/workspace details stay available in internal logs. Public maps
  intentionally expose only bounded, machine-readable details.
  """

  @enforce_keys [:code, :category, :retryable, :message]
  defstruct [:code, :category, :retryable, :message, details: %{}]

  @canonical_fields ~w(code category retryable message details)

  @type t :: %__MODULE__{
          code: String.t(),
          category: String.t(),
          retryable: boolean(),
          message: String.t(),
          details: map()
        }

  @spec normalize(term()) :: t()
  def normalize(%__MODULE__{} = error), do: error

  def normalize({:workspace_symlink_escape, _path, _root}) do
    error(
      "workspace_not_executable",
      "workspace",
      false,
      "The workspace is not safe to execute.",
      %{"reason" => "symlink_escape"}
    )
  end

  def normalize({:authoring_goal_unavailable, :workspace_not_executable}) do
    error(
      "workspace_not_executable",
      "workspace",
      false,
      "The workspace is not available for agent execution."
    )
  end

  def normalize(reason) when reason in [:epipe, :closed, :noproc] do
    error(
      "provider_disconnected",
      "provider",
      true,
      "The agent provider disconnected before the operation completed."
    )
  end

  def normalize({:resume_session_not_found, conversation_id}) do
    error(
      "conversation_not_found",
      "provider",
      false,
      "The provider conversation no longer exists.",
      %{"conversation_id" => to_string(conversation_id)}
    )
  end

  def normalize({:resume_conversation_failed, conversation_id, reason}) do
    error(
      "conversation_resume_failed",
      "provider",
      false,
      "The provider conversation could not be resumed.",
      %{
        "conversation_id" => to_string(conversation_id),
        "reason" => inspect(reason)
      }
    )
  end

  def normalize(:turn_in_progress) do
    error("turn_in_progress", "lifecycle", true, "Another turn is already running.")
  end

  def normalize(:assistant_busy) do
    error("assistant_busy", "lifecycle", true, "assistant is busy")
  end

  def normalize(:tool_not_running) do
    error("tool_not_running", "lifecycle", false, "tool_not_running")
  end

  def normalize(:no_worker) do
    error("no_worker", "lifecycle", false, "no_worker")
  end

  def normalize(:execution_thread_not_interactive) do
    error(
      "execution_thread_not_interactive",
      "validation",
      false,
      "execution_thread_not_interactive"
    )
  end

  def normalize(:issue_thread_required) do
    error(
      "issue_thread_required",
      "validation",
      false,
      "this action is only supported for issue assistant threads"
    )
  end

  def normalize(:assistant_thread_required) do
    error(
      "assistant_thread_required",
      "validation",
      false,
      "this action requires a persistent assistant thread"
    )
  end

  def normalize(:assistant_thread_not_active) do
    error(
      "assistant_thread_not_active",
      "lifecycle",
      false,
      "the current assistant thread is not active"
    )
  end

  def normalize(:no_codex_thread) do
    error(
      "no_codex_thread",
      "validation",
      false,
      "pause requires a persisted native Codex thread; run a Codex turn first"
    )
  end

  def normalize(:interrupted) do
    error("interrupted", "lifecycle", true, "The turn was interrupted.")
  end

  def normalize({:unsupported_capability, capability}) do
    error(
      "unsupported_capability",
      "capability",
      false,
      "The selected provider does not support this operation.",
      %{"capability" => to_string(capability)}
    )
  end

  def normalize({:unsupported_provider, provider}) do
    error(
      "unsupported_provider",
      "capability",
      false,
      "The selected agent provider is not supported by this client.",
      %{"provider" => to_string(provider)}
    )
  end

  def normalize({:provider_mismatch, expected_provider, actual_provider}) do
    error(
      "provider_mismatch",
      "validation",
      false,
      "The agent result belongs to a different provider.",
      %{
        "expected_provider" => to_string(expected_provider),
        "actual_provider" => to_string(actual_provider)
      }
    )
  end

  def normalize(:conversation_id_required) do
    error(
      "conversation_id_required",
      "validation",
      false,
      "A conversation_id is required for this operation."
    )
  end

  def normalize(:prompt_required) do
    error(
      "prompt_required",
      "validation",
      false,
      "A prompt is required for this operation."
    )
  end

  def normalize(:invalid_cli_arguments) do
    error(
      "invalid_cli_arguments",
      "validation",
      false,
      "The command-line arguments are invalid."
    )
  end

  def normalize({:invalid_execution_mode, mode}) do
    error(
      "invalid_execution_mode",
      "validation",
      false,
      "The execution mode is invalid.",
      %{"mode" => to_string(mode), "supported_modes" => ["plan", "build", "yolo"]}
    )
  end

  def normalize(:unknown_agent_command) do
    error(
      "unknown_agent_command",
      "validation",
      false,
      "The agent command is not supported."
    )
  end

  def normalize(error_map) when is_map(error_map) do
    case canonical_error(error_map) do
      {:ok, error} -> error
      :error -> operation_failed(error_map)
    end
  end

  def normalize(reason) do
    operation_failed(reason)
  end

  defp operation_failed(reason) do
    error(
      "agent_operation_failed",
      "internal",
      false,
      "The agent operation failed.",
      %{"reason" => bounded_reason(reason)}
    )
  end

  defp canonical_error(error_map) do
    keys =
      Enum.map(Map.keys(error_map), fn
        key when is_atom(key) -> Atom.to_string(key)
        key when is_binary(key) -> key
        _key -> nil
      end)

    code = error_field(error_map, :code)
    category = error_field(error_map, :category)
    retryable = error_field(error_map, :retryable)
    message = error_field(error_map, :message)
    details = error_field(error_map, :details)

    if Enum.sort(keys) == Enum.sort(@canonical_fields) and
         is_binary(code) and code != "" and is_binary(category) and category != "" and
         is_boolean(retryable) and is_binary(message) and message != "" and is_map(details) do
      {:ok,
       %__MODULE__{
         code: code,
         category: category,
         retryable: retryable,
         message: message,
         details: details
       }}
    else
      :error
    end
  end

  defp error_field(map, key) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end

  @spec to_map(term()) :: map()
  def to_map(reason) do
    reason
    |> normalize()
    |> Map.from_struct()
    |> stringify_keys()
  end

  defp error(code, category, retryable, message, details \\ %{}) do
    %__MODULE__{
      code: code,
      category: category,
      retryable: retryable,
      message: message,
      details: details
    }
  end

  defp bounded_reason(reason) do
    reason
    |> inspect(limit: 8, printable_limit: 200)
    |> String.slice(0, 500)
  end

  defp stringify_keys(map) do
    Map.new(map, fn {key, value} -> {to_string(key), value} end)
  end
end
