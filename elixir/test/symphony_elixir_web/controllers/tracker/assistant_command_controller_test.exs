defmodule SymphonyElixirWeb.Tracker.AssistantCommandControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)
    tmp_dir = tmp_dir!()
    skills_root = Path.join(tmp_dir, "skills")

    write_skill!(skills_root, "commit", skill_with_front_matter("Commit helper", "Create commit messages."))
    write_skill!(skills_root, "debug", "# Debug skill\n")
    write_skill!(Path.join(skills_root, "superpowers"), "brainstorming", "# Brainstorming\n")

    Application.put_env(:symphony_elixir, :skills_root, skills_root)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_skills_root(previous_skills_root)
      File.rm_rf!(tmp_dir)
    end)

    {:ok, conn: authorize()}
  end

  test "GET /assistant/commands returns execution commands by default", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands")
    %{"data" => commands} = json_response(conn, 200)

    assert %{
             "slug" => "goal",
             "kind" => "builtin",
             "category" => "builtin",
             "source" => "builtin",
             "submitKind" => "goal"
           } = find_command(commands, "goal")

    assert %{
             "slug" => "commit",
             "name" => "Commit helper",
             "description" => "Create commit messages.",
             "kind" => "skill",
             "category" => "workflow",
             "source" => "skills",
             "submitKind" => nil
           } = find_command(commands, "commit")

    assert find_command(commands, "brainstorming") == nil
  end

  test "GET /assistant/commands with authoring context includes authoring-only skills", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands?context=authoring")
    %{"data" => commands} = json_response(conn, 200)

    assert %{"slug" => "brainstorming", "category" => "superpowers"} = find_command(commands, "brainstorming")
  end

  test "GET /assistant/commands with implementation profile excludes authoring-only skills", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands?context=implementation")
    %{"data" => commands} = json_response(conn, 200)

    assert find_command(commands, "commit")
    assert find_command(commands, "goal")
    assert find_command(commands, "brainstorming") == nil
  end

  test "GET /assistant/commands with planning profile includes authoring-only skills", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands?context=planning")
    %{"data" => commands} = json_response(conn, 200)

    assert %{"slug" => "brainstorming", "category" => "superpowers"} = find_command(commands, "brainstorming")
  end

  test "GET /assistant/commands with auto profile includes authoring-only skills", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands?context=auto")
    %{"data" => commands} = json_response(conn, 200)

    assert %{"slug" => "brainstorming", "category" => "superpowers"} = find_command(commands, "brainstorming")
  end

  test "GET /projects/:project_slug/assistant/commands mirrors global endpoint", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/projects/demo/assistant/commands?context=execution")
    %{"data" => commands} = json_response(conn, 200)

    assert find_command(commands, "commit")
    assert find_command(commands, "goal")
  end

  test "GET /projects/:project_slug/assistant/commands accepts skill profile context", %{conn: conn} do
    conn =
      get(conn, "/api/tracker/v1/projects/demo/assistant/commands?context=implementation")

    %{"data" => commands} = json_response(conn, 200)

    assert find_command(commands, "commit")
    assert find_command(commands, "brainstorming") == nil
  end

  test "GET /assistant/commands rejects invalid context", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/assistant/commands?context=invalid")
    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  defp find_command(commands, slug), do: Enum.find(commands, &(&1["slug"] == slug))

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end

  defp tmp_dir! do
    dir =
      Path.join(
        System.tmp_dir!(),
        "assistant-command-controller-test-#{System.unique_integer([:positive])}"
      )

    File.rm_rf!(dir)
    File.mkdir_p!(dir)
    dir
  end

  defp write_skill!(root, name, body) do
    dir = Path.join(root, name)
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "SKILL.md"), body)
  end

  defp skill_with_front_matter(name, description) do
    """
    ---
    name: #{name}
    description: #{description}
    ---
    # #{name}
    """
  end

  defp restore_skills_root(nil), do: Application.delete_env(:symphony_elixir, :skills_root)
  defp restore_skills_root(value), do: Application.put_env(:symphony_elixir, :skills_root, value)
end
