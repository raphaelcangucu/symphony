defmodule SymphonyElixir.AgentLifecycle.Probe do
  @moduledoc "Executable and PATH probes for managed agent CLI resolution."

  import Bitwise

  alias SymphonyElixir.AgentLifecycle.Catalog

  @type result :: %{
          path: Path.t(),
          version: String.t(),
          probed_at: integer()
        }

  @spec executable(String.t(), Path.t(), keyword()) :: {:ok, result()} | {:error, atom()}
  def executable(kind, path, opts \\ []) when is_binary(kind) and is_binary(path) do
    with {:ok, entry} <- catalog(kind),
         {:ok, stat} <- File.stat(path),
         true <- stat.type == :regular or {:error, :not_regular},
         true <- executable_mode?(stat.mode) or {:error, :not_executable},
         {output, 0} <- command(opts).(path, entry.version_args),
         version when is_binary(version) and version != "" <- first_line(output) do
      {:ok, %{path: Path.expand(path), version: version, probed_at: now(opts)}}
    else
      {:error, :enoent} -> {:error, :missing}
      {:error, reason} when is_atom(reason) -> {:error, reason}
      {_output, _status} -> {:error, :version_probe_failed}
      nil -> {:error, :version_probe_failed}
      :error -> {:error, :unknown_agent}
    end
  rescue
    _error -> {:error, :version_probe_failed}
  end

  @spec path(String.t(), keyword()) :: {:ok, result()} | {:error, atom()}
  def path(kind, opts \\ []) when is_binary(kind) do
    with {:ok, entry} <- catalog(kind),
         candidate when is_binary(candidate) <-
           find_path_candidate(entry.executable_candidates, opts) do
      executable(kind, candidate, opts)
    else
      nil -> {:error, :missing}
      :error -> {:error, :unknown_agent}
    end
  end

  defp find_path_candidate(names, opts) do
    managed = opts |> Keyword.get(:managed_path) |> comparable_path()
    path_env = Keyword.get(opts, :path_env, System.get_env("PATH") || "")

    path_env
    |> String.split(path_separator(), trim: true)
    |> Enum.find_value(fn dir ->
      Enum.find_value(names, fn name ->
        candidate = Path.expand(Path.join(dir, platform_name(name)))

        if comparable_path(candidate) != managed and File.regular?(candidate) do
          candidate
        end
      end)
    end)
  end

  defp executable_mode?(mode), do: (mode &&& 0o111) != 0

  defp command(opts) do
    Keyword.get(opts, :command, fn path, args ->
      System.cmd(path, args, stderr_to_stdout: true)
    end)
  end

  defp first_line(output) do
    output
    |> to_string()
    |> String.split("\n", trim: true)
    |> List.first()
  end

  defp catalog(kind), do: Catalog.fetch(kind)

  defp now(opts), do: Keyword.get(opts, :now, System.system_time(:second))

  defp comparable_path(nil), do: nil

  defp comparable_path(path) do
    expanded = Path.expand(path)
    if match?({:win32, _}, :os.type()), do: String.downcase(expanded), else: expanded
  end

  defp platform_name(name) do
    if match?({:win32, _}, :os.type()), do: name <> ".exe", else: name
  end

  defp path_separator, do: if(match?({:win32, _}, :os.type()), do: ";", else: ":")
end
