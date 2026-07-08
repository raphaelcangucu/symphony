defmodule SymphonyElixir.Assistant.ForkSession do
  @moduledoc """
  Forks an assistant session into a new, independent parallel session.

  A fork creates a brand-new thread that carries over the source conversation
  transcript (so the new agent starts with the same context) but gets its own
  fresh isolated working tree and a fresh agent brain: native agent thread ids
  (`agent_thread_ids`/`codex_thread_id`) and goal state are intentionally NOT
  copied, so the source and the fork can run in parallel without colliding.

  Supported source scopes:

    * `"issue_session"` -> new isolated sibling working tree (`<id>__pN`)
    * `"project_session"` -> new standalone workspace (`__ws_fork-...`)
  """

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Workspace.Standalone

  @forkable_scopes ~w(issue_session project_session)

  @spec fork(Thread.t()) :: {:ok, Thread.t()} | {:error, term()}
  def fork(%Thread{scope: scope} = source) when scope in @forkable_scopes do
    with {:ok, target} <- create_target(source),
         {:ok, target} <- copy_history(source, target) do
      {:ok, target}
    end
  end

  def fork(%Thread{}), do: {:error, :unsupported_scope}

  defp create_target(%Thread{scope: "issue_session"} = source) do
    History.create_issue_session_thread(source.project_slug, source.issue_identifier, %{
      title: fork_title(source),
      agent_kind: source.agent_kind,
      execution_mode: execution_mode(source),
      isolated_workspace: true,
      metadata: %{"forked_from_thread_id" => source.id}
    })
  end

  defp create_target(%Thread{scope: "project_session"} = source) do
    name = "fork-#{source.id}-#{System.unique_integer([:positive])}"

    with {:ok, path} <- Standalone.create(source.project_slug, name) do
      History.create_workspace_session_thread(source.project_slug, path, %{
        title: fork_title(source),
        agent_kind: source.agent_kind,
        metadata: %{"forked_from_thread_id" => source.id}
      })
    end
  end

  defp copy_history(%Thread{} = source, %Thread{} = target) do
    messages = History.list_messages_for_thread(source.id)
    History.copy_messages_to_empty_thread(target, messages)
  end

  defp fork_title(%Thread{title: title}) when is_binary(title) and title != "",
    do: "#{title} (fork)"

  defp fork_title(%Thread{}), do: "Session fork"

  defp execution_mode(%Thread{metadata: %{"execution_mode" => mode}}) when is_binary(mode), do: mode
  defp execution_mode(%Thread{}), do: nil
end
