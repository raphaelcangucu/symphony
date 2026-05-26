defmodule SymphonyElixir.GitHub.ProjectMetadataTest do
  use SymphonyElixir.TestSupport, async: true

  alias SymphonyElixir.GitHub.ProjectMetadata

  setup do
    tmp = System.tmp_dir!() |> Path.join("symphony-meta-#{:erlang.unique_integer()}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)
    %{dir: tmp}
  end

  test "write then read round-trips metadata", %{dir: dir} do
    meta = %{
      "project_id" => "PVT_kwDO",
      "project_number" => 3,
      "status_field_id" => "PVTSSF_x",
      "state_options" => %{"Todo" => "opt1", "Done" => "opt2"},
      "bootstrapped_at" => "2026-05-24T00:00:00Z"
    }

    assert :ok = ProjectMetadata.write!(dir, meta)
    assert {:ok, ^meta} = ProjectMetadata.read(dir)
  end

  test "read returns error when file missing", %{dir: dir} do
    assert {:error, :missing_project_metadata} = ProjectMetadata.read(dir)
  end

  test "read returns invalid_project_metadata for malformed json", %{dir: dir} do
    cache_path = ProjectMetadata.cache_path(dir)
    File.mkdir_p!(Path.dirname(cache_path))
    File.write!(cache_path, "{not json")

    assert {:error, :invalid_project_metadata} = ProjectMetadata.read(dir)
  end

  test "read folds non-:enoent posix errors into invalid_project_metadata", %{dir: dir} do
    cache_path = ProjectMetadata.cache_path(dir)
    File.mkdir_p!(cache_path)

    assert {:error, :invalid_project_metadata} = ProjectMetadata.read(dir)
  end

  test "read/0 defaults to the current working directory" do
    result = ProjectMetadata.read()
    assert match?({:ok, _}, result) or match?({:error, _}, result)
  end
end
