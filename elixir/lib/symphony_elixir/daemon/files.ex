defmodule SymphonyElixir.Daemon.Files do
  @moduledoc "Crash-safe writes used by daemon installation."

  @spec atomic_write(Path.t(), iodata(), non_neg_integer()) ::
          :ok | {:error, term()}
  def atomic_write(path, contents, mode) do
    :ok = File.mkdir_p(Path.dirname(path))
    temp = path <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with {:ok, file} <- File.open(temp, [:write, :binary, :exclusive]),
         :ok <- IO.binwrite(file, contents),
         :ok <- :file.sync(file),
         :ok <- File.close(file),
         :ok <- File.chmod(temp, mode),
         :ok <- File.rename(temp, path) do
      :ok
    else
      {:error, reason} = error ->
        File.rm(temp)
        if reason == :eexist, do: atomic_write(path, contents, mode), else: error
    end
  end

  @spec atomic_symlink(Path.t(), Path.t()) :: :ok | {:error, term()}
  def atomic_symlink(target, link) do
    :ok = File.mkdir_p(Path.dirname(link))
    temp = link <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with :ok <- File.ln_s(target, temp),
         :ok <- replace_link(temp, link) do
      :ok
    else
      {:error, _reason} = error ->
        File.rm(temp)
        error
    end
  end

  defp replace_link(temp, link) do
    case File.rename(temp, link) do
      :ok ->
        :ok

      {:error, :eexist} ->
        :ok = File.rm(link)
        File.rename(temp, link)

      error ->
        error
    end
  end
end
