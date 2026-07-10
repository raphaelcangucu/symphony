defmodule SymphonyElixir.Assistant.UserInputHttp do
  @moduledoc """
  Loopback HTTP handler for Claude PreToolUse AskUserQuestion awaits.

  Invoked from `ToolGateway` on `POST /user-input/:session_token` so the
  Bandit listener stays the single loopback port while Assistant owns the
  broker/channel correlation (ToolGateway must not import Phoenix).
  """

  import Plug.Conn

  alias SymphonyElixir.Assistant.{UserInputBroker, UserQuestionNormalizer}

  @default_timeout_ms 300_000

  @doc "Handle an inbound user-input await request; returns a halted conn."
  @spec handle_conn(Plug.Conn.t(), String.t()) :: Plug.Conn.t()
  def handle_conn(%Plug.Conn{} = conn, session_token) when is_binary(session_token) do
    UserInputBroker.ensure_started()

    case UserInputBroker.lookup_session(session_token) do
      :error ->
        json_resp(conn, 401, %{"error" => "unauthorized"})

      {:ok, %{channel_pid: channel_pid}} when is_pid(channel_pid) ->
        body = conn.body_params || %{}
        request_id = Map.get(body, "request_id")
        claude_questions = Map.get(body, "questions") || []
        timeout_ms = parse_timeout(Map.get(body, "timeout_ms"))

        cond do
          not is_binary(request_id) or request_id == "" ->
            json_resp(conn, 400, %{"error" => "request_id required"})

          not is_list(claude_questions) ->
            json_resp(conn, 400, %{"error" => "questions must be a list"})

          true ->
            await_operator(conn, channel_pid, request_id, claude_questions, timeout_ms)
        end
    end
  end

  defp await_operator(conn, channel_pid, request_id, claude_questions, timeout_ms) do
    ui_questions = UserQuestionNormalizer.to_ui_questions(claude_questions)

    send(channel_pid, {:assistant_user_input_required, %{request_id: request_id, questions: ui_questions}})

    case UserInputBroker.await(request_id, timeout_ms) do
      {:ok, codex_answers} when is_map(codex_answers) ->
        answers = UserQuestionNormalizer.to_claude_answers(ui_questions, claude_questions, codex_answers)

        json_resp(conn, 200, %{
          "permissionDecision" => "allow",
          "updatedInput" => %{
            "questions" => claude_questions,
            "answers" => answers
          }
        })

      {:error, :timeout} ->
        json_resp(conn, 504, %{
          "permissionDecision" => "deny",
          "permissionDecisionReason" => "Operator input timed out"
        })

      {:error, :duplicate} ->
        json_resp(conn, 409, %{"error" => "duplicate request_id"})
    end
  end

  defp parse_timeout(value) when is_integer(value) and value >= 0, do: value

  defp parse_timeout(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n >= 0 -> n
      _ -> @default_timeout_ms
    end
  end

  defp parse_timeout(_), do: @default_timeout_ms

  defp json_resp(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end
end
