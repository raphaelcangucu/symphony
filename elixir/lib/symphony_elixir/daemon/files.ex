defmodule SymphonyElixir.Daemon.Files do
  @moduledoc "Crash-safe writes used by daemon installation."

  @spec ensure_private_dir(Path.t()) :: :ok | {:error, term()}
  def ensure_private_dir(path) do
    with :ok <- File.mkdir_p(path),
         :ok <- File.chmod(path, 0o700) do
      :ok
    end
  end

  @spec atomic_write(Path.t(), iodata(), non_neg_integer()) ::
          :ok | {:error, term()}
  def atomic_write(path, contents, mode) do
    temp = path <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- write_temp(temp, contents),
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
    temp = link <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with :ok <- File.mkdir_p(Path.dirname(link)),
         :ok <- File.ln_s(target, temp),
         :ok <- replace_link(temp, link) do
      :ok
    else
      {:error, _reason} = error ->
        File.rm(temp)
        error
    end
  end

  defp write_temp(temp, contents) do
    case File.open(temp, [:write, :binary, :exclusive]) do
      {:ok, file} ->
        try do
          with :ok <- IO.binwrite(file, contents),
               :ok <- :file.sync(file) do
            :ok
          end
        after
          File.close(file)
        end

      {:error, _reason} = error ->
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
