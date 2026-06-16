defmodule SymphonyElixir.Assistant.SessionManager do
  @moduledoc """
  Stateless assistant session boundary for project-scoped tracker chat turns.
  """

  alias SymphonyElixir.Assistant.ToolExecutor

  @type message_result :: %{
          required(:assistant_message) => String.t(),
          required(:tool_calls) => [map()]
        }

  @spec handle_message(String.t(), String.t()) :: {:ok, message_result()} | {:error, term()}
  def handle_message(project_slug, message), do: handle_message(project_slug, message, %{})

  @spec handle_message(String.t(), String.t(), map()) :: {:ok, message_result()} | {:error, term()}
  def handle_message(project_slug, message, context)
      when is_binary(project_slug) and is_binary(message) and is_map(context) do
    with {:ok, trimmed} <- normalize_message(message),
         {:ok, intent} <- infer_intent(trimmed, context),
         {:ok, result} <- handle_intent(project_slug, intent) do
      {:ok, result}
    end
  end

  def handle_message(_project_slug, _message, _context), do: {:error, :invalid_arguments}

  defp normalize_message(message) do
    case String.trim(message) do
      "" -> {:error, :message_required}
      trimmed -> {:ok, trimmed}
    end
  end

  defp infer_intent("create issue:" <> title, _context) do
    {:ok, %{tool: "create_issue", arguments: %{"title" => title |> String.trim()}}}
  end

  defp infer_intent("agent executions", _context) do
    {:ok, %{tool: "get_agent_executions", arguments: %{}}}
  end

  defp infer_intent(message, _context) do
    with :no_match <- codex_dispatch_intent(message),
         :no_match <- move_issue_intent(message),
         :no_match <- comment_intent(message),
         :no_match <- update_title_intent(message) do
      if issue_search?(message) do
        {:ok, %{tool: "list_issues", arguments: %{"search" => issue_search_query(message)}}}
      else
        {:ok, %{reply: conversational_reply(message)}}
      end
    end
  end

  defp handle_intent(_project_slug, %{reply: reply}) do
    {:ok, %{assistant_message: reply, tool_calls: []}}
  end

  defp handle_intent(project_slug, %{tool: tool, arguments: arguments}) do
    with {:ok, tool_result} <- ToolExecutor.execute(project_slug, tool, arguments) do
      {:ok,
       %{
         assistant_message: tool_result.message,
         tool_calls: [tool_call(tool_result)]
       }}
    end
  end

  defp codex_dispatch_intent(message) do
    case Regex.run(~r/^start\s+codex\s+on\s+(#?[A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(.+)$/i, message) do
      [_, identifier, instructions] ->
        {:ok,
         %{
           tool: "dispatch_codex",
           arguments: %{"identifier" => normalize_identifier(identifier), "instructions" => String.trim(instructions)}
         }}

      _ ->
        :no_match
    end
  end

  defp move_issue_intent(message) do
    case Regex.run(~r/^move\s+(#?[A-Za-z0-9][A-Za-z0-9_-]*)\s+to\s+(.+)$/i, message) do
      [_, identifier, status] ->
        {:ok, %{tool: "move_issue", arguments: %{"identifier" => normalize_identifier(identifier), "status" => String.trim(status)}}}

      _ ->
        :no_match
    end
  end

  defp comment_intent(message) do
    case Regex.run(~r/^comment\s+on\s+(#?[A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(.+)$/i, message) do
      [_, identifier, body] ->
        {:ok, %{tool: "add_comment", arguments: %{"identifier" => normalize_identifier(identifier), "body" => String.trim(body)}}}

      _ ->
        :no_match
    end
  end

  defp update_title_intent(message) do
    case Regex.run(~r/^update\s+(#?[A-Za-z0-9][A-Za-z0-9_-]*)\s+title\s*:\s*(.+)$/i, message) do
      [_, identifier, title] ->
        {:ok, %{tool: "update_issue", arguments: %{"identifier" => normalize_identifier(identifier), "title" => String.trim(title)}}}

      _ ->
        :no_match
    end
  end

  defp normalize_identifier("#" <> identifier), do: String.trim(identifier)
  defp normalize_identifier(identifier), do: identifier |> String.trim() |> String.upcase()

  defp issue_search?(message) do
    normalized = message |> String.downcase() |> String.trim()

    String.contains?(normalized, [
      "issue",
      "issues",
      "tarefa",
      "tarefas",
      "task",
      "tasks",
      "listar",
      "liste",
      "list ",
      "buscar",
      "busque",
      "procurar",
      "procure"
    ])
  end

  defp issue_search_query(message) do
    message
    |> String.replace(~r/^(listar|liste|list|buscar|busque|procurar|procure)\s+/iu, "")
    |> String.trim()
  end

  defp conversational_reply(message) do
    normalized = message |> String.downcase() |> String.trim()

    cond do
      greeting?(normalized) ->
        "Oi! Estou aqui no contexto deste projeto. Pode conversar comigo normalmente ou pedir ações como criar tarefa, comentar em uma issue, mover status ou pedir trabalho do Codex."

      String.contains?(normalized, ["conversacional", "conversar", "conversa", "chat"]) ->
        "Eu estava tratando texto livre como busca de issues, por isso a resposta parecia robótica. Agora mensagens conversacionais ficam no chat, e eu só consulto ferramentas quando você pede uma ação ou busca explicitamente."

      true ->
        "Entendi. Posso conversar sobre o projeto e acionar ferramentas do tracker quando você pedir algo concreto, como criar uma tarefa, comentar em uma issue, mover status, consultar tarefas ou pedir trabalho do Codex."
    end
  end

  defp greeting?(normalized) do
    normalized in ["oi", "olá", "ola", "hello", "hi", "hey", "bom dia", "boa tarde", "boa noite"]
  end

  defp tool_call(tool_result) do
    %{
      name: tool_result.tool,
      status: "complete",
      result: result_payload(tool_result)
    }
  end

  defp result_payload(%{tool: tool, data: issue}) when tool in ["create_issue", "update_issue", "move_issue", "dispatch_codex"],
    do: %{issue: issue}

  defp result_payload(%{tool: "add_comment", data: %{comment: comment}}), do: %{comment: comment}
  defp result_payload(%{tool: "list_issues", data: %{issues: issues}}), do: %{issues: issues}
  defp result_payload(%{tool: "get_agent_executions", data: %{agent_executions: executions}}), do: %{agent_executions: executions}
  defp result_payload(%{data: data}), do: data
end
