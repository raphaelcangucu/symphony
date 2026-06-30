defmodule SymphonyElixirWeb.Tracker.RunPromptTemplateControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PromptTemplates
  alias SymphonyElixir.PromptTemplates.Template
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)

    clean_repo()
    PromptTemplates.ensure_builtins()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    previous_sync = Application.get_env(:symphony_elixir, :tracker, []) |> Keyword.get(:sync_enabled)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    on_exit(fn ->
      tracker_config = Application.get_env(:symphony_elixir, :tracker, [])

      tracker_config =
        case previous_sync do
          nil -> Keyword.delete(tracker_config, :sync_enabled)
          value -> Keyword.put(tracker_config, :sync_enabled, value)
        end

      Application.put_env(:symphony_elixir, :tracker, tracker_config)
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "runs code-review template and dispatches" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, issue} = Context.create_issue("macro-markets", %{title: "Fix login", status: "Todo"})
    {:ok, issue} = Context.update_issue("macro-markets", issue.identifier, %{"labels" => ["symphony"]})

    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/macro-markets/issues/#{issue.identifier}/run-prompt-template",
        %{"slug" => "code-review", "model" => nil, "effort" => nil, "mode" => nil, "agent" => nil}
      )

    assert %{
             "data" => %{
               "ok" => true,
               "action" => "resume",
               "issue" => %{"identifier" => issue_identifier}
             }
           } = json_response(conn, 200)

    assert issue_identifier == issue.identifier

    assert {:ok, settings} = Context.get_agent_settings("macro-markets", issue.identifier)
    assert settings.agent_kind == "codex"
    assert settings.effort == "high"
    assert settings.mode == "build"

    assert {:ok, comments} = Context.list_comments("macro-markets", issue.identifier)

    assert Enum.any?(comments, fn comment ->
             String.contains?(
               comment.body,
               "Review the changes for issue #{issue.identifier}: #{issue.title}."
             )
           end)
  end

  test "unknown slug -> 404" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, issue} = Context.create_issue("macro-markets", %{title: "Fix login", status: "Todo"})

    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/macro-markets/issues/#{issue.identifier}/run-prompt-template",
        %{"slug" => "missing-template"}
      )

    assert %{"error" => %{"code" => "template_not_found"}} = json_response(conn, 404)
  end

  test "disabled template -> 422" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, issue} = Context.create_issue("macro-markets", %{title: "Fix login", status: "Todo"})

    {:ok, _template} =
      PromptTemplates.create(%{
        slug: "code-review",
        name: "Disabled code review",
        body: "Disabled template body",
        scope: "macro-markets",
        enabled: false
      })

    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/macro-markets/issues/#{issue.identifier}/run-prompt-template",
        %{"slug" => "code-review"}
      )

    assert %{
             "error" => %{
               "code" => "validation_failed",
               "message" => "prompt template is disabled"
             }
           } = json_response(conn, 422)
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    Repo.delete_all(Template)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
