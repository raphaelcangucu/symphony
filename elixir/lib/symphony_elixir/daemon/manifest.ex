defmodule SymphonyElixir.Daemon.Manifest do
  @moduledoc "Reads and writes daemon candidate and installation manifests."

  alias SymphonyElixir.Daemon.Files

  @spec read(Path.t()) :: {:ok, map()} | {:error, :missing | :invalid}
  def read(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{} = decoded} <- Jason.decode(body) do
      {:ok, decoded}
    else
      {:error, :enoent} -> {:error, :missing}
      _ -> {:error, :invalid}
    end
  end

  @spec write(Path.t(), map()) :: :ok | {:error, term()}
  def write(path, manifest) when is_map(manifest) do
    Files.atomic_write(path, Jason.encode_to_iodata!(manifest, pretty: true), 0o644)
  end
end
