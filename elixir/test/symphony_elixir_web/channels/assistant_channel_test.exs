defmodule SymphonyElixirWeb.AssistantChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    previous_runner = Application.get_env(:symphony_elixir, :assistant_runner)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:assistant_runner, previous_runner)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    :ok
  end

  test "joins assistant topic, streams a turn, and replays persisted history" do
    runner = fn _workspace, _prompt, _issue, opts ->
      Keyword.fetch!(opts, :on_assistant_delta).("Oi")

      {:ok,
       %{
         assistant_message: "Oi! Sou o assistant do projeto.",
         codex_thread_id: "thread-1",
         turn_id: "turn-1",
         tool_calls: []
       }}
    end

    Application.put_env(:symphony_elixir, :assistant_runner, runner)

    {:ok, %{messages: []}, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert_push("history_loaded", %{messages: []})

    ref = push(socket, "send_message", %{"message" => "Oi", "context" => %{"view" => "board"}})
    assert_reply(ref, :ok, %{})

    assert_push("message_created", %{message: %{role: "user", content: "Oi"}})
    assert_push("assistant_delta", %{delta: "Oi"})
    assert_push("assistant_completed", %{message: %{role: "assistant", content: "Oi! Sou o assistant do projeto."}})

    {:ok, %{messages: messages}, _socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
      |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

    assert Enum.map(messages, & &1.role) == ["user", "assistant"]
  end

  test "rejects assistant topic without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "wrong"})
             |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
