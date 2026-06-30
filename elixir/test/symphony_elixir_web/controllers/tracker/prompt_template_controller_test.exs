defmodule SymphonyElixirWeb.Tracker.PromptTemplateControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.PromptTemplates
  alias SymphonyElixir.PromptTemplates.Template
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    clean_repo()
    PromptTemplates.ensure_builtins()

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env)
    end)

    :ok
  end

  test "index lists enabled global prompt templates" do
    {:ok, _disabled_global} =
      PromptTemplates.create(%{
        slug: "disabled-global",
        name: "Disabled global",
        body: "noop",
        scope: "global",
        enabled: false
      })

    conn = get(authorized_conn(), "/api/tracker/v1/prompt-templates")
    %{"data" => templates} = json_response(conn, 200)

    assert Enum.any?(templates, &(&1["slug"] == "investigate-issue"))
    refute Enum.any?(templates, &(&1["slug"] == "disabled-global"))

    assert %{
             "agentKind" => "codex",
             "builtIn" => true,
             "enabled" => true,
             "insertedAt" => _,
             "updatedAt" => _
           } = Enum.find(templates, &(&1["slug"] == "investigate-issue"))
  end

  test "project index merges global and project scope with project shadowing global" do
    {:ok, _project_override} =
      PromptTemplates.create(%{
        slug: "code-review",
        name: "Project code review",
        body: "Project override",
        scope: "demo-project",
        enabled: true
      })

    {:ok, _project_only} =
      PromptTemplates.create(%{
        slug: "project-only",
        name: "Project only",
        body: "Project only body",
        scope: "demo-project",
        enabled: true
      })

    {:ok, _project_disabled_shadow} =
      PromptTemplates.create(%{
        slug: "commit-message",
        name: "Disabled project shadow",
        body: "Disabled",
        scope: "demo-project",
        enabled: false
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/demo-project/prompt-templates")
    %{"data" => templates} = json_response(conn, 200)

    assert Enum.count(templates, &(&1["slug"] == "code-review")) == 1
    assert Enum.find(templates, &(&1["slug"] == "code-review"))["scope"] == "demo-project"
    assert Enum.any?(templates, &(&1["slug"] == "project-only"))
    refute Enum.any?(templates, &(&1["slug"] == "commit-message"))
  end

  test "project index rejects blank project slug" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/%20%20/prompt-templates")
    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    Repo.delete_all(Template)
  end
end
