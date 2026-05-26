defmodule SymphonyElixir.GitHub.ProjectMetadata do
  @moduledoc false

  @filename "github-project.json"
  @default_rel_dir ".symphony"

  @spec cache_path(Path.t()) :: Path.t()
  def cache_path(base \\ File.cwd!()), do: Path.join(base, Path.join(@default_rel_dir, @filename))

  @spec read(Path.t()) :: {:ok, map()} | {:error, :missing_project_metadata | :invalid_project_metadata}
  def read(base \\ File.cwd!()) do
    path = cache_path(base)

    case File.read(path) do
      {:ok, raw} ->
        case Jason.decode(raw) do
          {:ok, map} when is_map(map) -> {:ok, map}
          _ -> {:error, :invalid_project_metadata}
        end

      {:error, :enoent} ->
        {:error, :missing_project_metadata}

      {:error, _posix} ->
        # Fold any non-:enoent posix error (e.g. :eacces, :eisdir) into
        # :invalid_project_metadata so the public contract stays narrow.
        {:error, :invalid_project_metadata}
    end
  end

  @spec write!(Path.t(), map()) :: :ok
  def write!(base, metadata) when is_map(metadata) do
    path = cache_path(base)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, Jason.encode!(metadata))
  end
end
