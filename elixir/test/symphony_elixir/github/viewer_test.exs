defmodule SymphonyElixir.GitHub.ViewerTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.GitHub.{ProjectMetadata, Viewer}

  defmodule ViewerMock do
    def graphql(_query, _vars, _opts), do: {:ok, %{"data" => %{"viewer" => %{"login" => "octocat"}}}}
  end

  defmodule WorkerMock do
    def graphql(_query, _vars, _opts),
      do: {:ok, %{"data" => %{"viewer" => %{"login" => "worker-bot"}}}}
  end

  defmodule NoCallViewerMock do
    def graphql(_, _, _), do: raise("should not call graphql")
  end

  defmodule EmptyViewerMock do
    def graphql(_, _, _), do: {:ok, %{"data" => %{"viewer" => %{"login" => "  "}}}}
  end

  defmodule BadViewerMock do
    def graphql(_, _, _), do: {:ok, %{"data" => %{}}}
  end

  defmodule ErrorViewerMock do
    def graphql(_, _, _), do: {:error, {:github_api_status, 500}}
  end

  setup do
    tmp = System.tmp_dir!() |> Path.join("symphony-viewer-#{:erlang.unique_integer()}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)
    %{dir: tmp}
  end

  test "resolve_login returns viewer login from GraphQL", %{dir: _dir} do
    assert {:ok, "octocat"} = Viewer.resolve_login(client_module: ViewerMock)
  end

  test "ensure_cached writes viewer_login into metadata", %{dir: dir} do
    metadata = %{
      "project_id" => "PVT_1",
      "state_options" => %{"Todo" => "opt1"}
    }

    ProjectMetadata.write!(dir, metadata)

    assert :ok = Viewer.ensure_cached(dir, client_module: WorkerMock)
    assert {:ok, %{"viewer_login" => "worker-bot"}} = ProjectMetadata.read(dir)
  end

  test "ensure_cached is no-op when viewer_login already present", %{dir: dir} do
    ProjectMetadata.write!(dir, %{"viewer_login" => "cached-user"})

    assert :ok = Viewer.ensure_cached(dir, client_module: NoCallViewerMock)
  end

  test "resolve_login returns error for empty login", %{dir: _dir} do
    assert {:error, :missing_github_viewer_login} = Viewer.resolve_login(client_module: EmptyViewerMock)
  end

  test "resolve_login returns error for unexpected payload", %{dir: _dir} do
    assert {:error, :missing_github_viewer_login} = Viewer.resolve_login(client_module: BadViewerMock)
  end

  test "ensure_cached returns error when metadata missing", %{dir: dir} do
    assert {:error, message} = Viewer.ensure_cached(dir, client_module: ViewerMock)
    assert message =~ "metadata missing"
  end

  test "cached_login returns nil when absent", %{dir: dir} do
    ProjectMetadata.write!(dir, %{"project_id" => "PVT"})
    assert Viewer.cached_login(dir) == nil
  end

  test "cached_login trims stored login", %{dir: dir} do
    ProjectMetadata.write!(dir, %{"viewer_login" => "  worker  "})
    assert Viewer.cached_login(dir) == "worker"
  end

  test "resolve_login propagates graphql errors", %{dir: _dir} do
    assert {:error, {:github_api_status, 500}} = Viewer.resolve_login(client_module: ErrorViewerMock)
  end

  test "ensure_cached returns error for invalid metadata file", %{dir: dir} do
    path = ProjectMetadata.cache_path(dir)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "not-json")

    assert {:error, message} = Viewer.ensure_cached(dir, client_module: ViewerMock)
    assert message =~ "Invalid GitHub project metadata"
  end

  test "cache_resolved_viewer_login surfaces formatted errors", %{dir: dir} do
    ProjectMetadata.write!(dir, %{"project_id" => "PVT_1"})

    assert {:error, message} = Viewer.ensure_cached(dir, client_module: ErrorViewerMock)
    assert message =~ "Failed to resolve GitHub viewer login"
    assert message =~ "500"
  end
end
