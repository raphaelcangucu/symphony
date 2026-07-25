defmodule Mix.Tasks.Symphony.Daemon do
  use Mix.Task

  @shortdoc "Manage the installed Symphony user daemon"

  @impl true
  def run(argv) do
    with {:ok, prepared_argv} <- prepare_argv(argv) do
      case SymphonyElixir.Daemon.CLI.run(["daemon" | prepared_argv]) do
        {:ok, result} -> Mix.shell().info(result.output)
        {:error, result} -> Mix.raise(result.output)
      end
    else
      {:error, reason} -> Mix.raise("could not build daemon release: #{inspect(reason)}")
    end
  end

  @doc false
  @spec prepare_argv([String.t()], keyword()) :: {:ok, [String.t()]} | {:error, term()}
  def prepare_argv(argv, opts \\ [])

  def prepare_argv(["install" | _rest] = argv, opts) do
    if explicit_artifact?(argv) do
      {:ok, argv}
    else
      build_release = Keyword.get(opts, :build_release, &build_release/0)
      artifact_path = Keyword.get(opts, :artifact_path, &default_artifact_path/0)

      with :ok <- build_release.() do
        {:ok, argv ++ ["--artifact", artifact_path.()]}
      end
    end
  end

  def prepare_argv(argv, _opts), do: {:ok, argv}

  @doc false
  @spec parse([String.t()]) ::
          {:ok, SymphonyElixir.Daemon.CLI.command()} | {:error, String.t()}
  def parse(argv), do: SymphonyElixir.Daemon.CLI.parse(["daemon" | argv])

  defp explicit_artifact?(argv) do
    Enum.any?(argv, &(&1 == "--artifact" or String.starts_with?(&1, "--artifact=")))
  end

  defp build_release do
    mix = System.find_executable("mix") || "mix"
    commit = git_commit()

    env = [
      {"MIX_ENV", "prod"},
      {"SYMPHONY_BUILD_COMMIT", commit},
      {"ERL_FLAGS", System.get_env("ERL_FLAGS") || "+S 4:4"}
    ]

    with :ok <- build_tracker(),
         :ok <- run_mix(mix, ["compile", "--force"], env),
         :ok <- run_mix(mix, ["release", "symphony", "--overwrite"], env),
         :ok <- rename_release_artifact() do
      :ok
    end
  end

  defp run_mix(mix, argv, env) do
    case System.cmd(mix, argv, env: env, stderr_to_stdout: true) do
      {output, 0} ->
        Mix.shell().info(output)
        :ok

      {output, status} ->
        {:error, {:mix_failed, argv, status, output}}
    end
  end

  defp build_tracker do
    npm = System.find_executable("npm") || "npm"
    tracker = Path.expand("../../../tracker", __DIR__)

    case System.cmd(npm, ["run", "build"], cd: tracker, stderr_to_stdout: true) do
      {output, 0} ->
        Mix.shell().info(output)
        :ok

      {output, status} ->
        {:error, {:tracker_build_failed, status, output}}
    end
  end

  @doc false
  @spec default_artifact_path() :: Path.t()
  def default_artifact_path do
    version = Mix.Project.config()[:version]
    architecture = :erlang.system_info(:system_architecture) |> to_string() |> String.split("-") |> hd()
    Path.expand("_build/prod/symphony-#{version}-linux-#{architecture}.tar.gz")
  end

  defp rename_release_artifact do
    version = Mix.Project.config()[:version]
    source = Path.expand("_build/prod/symphony-#{version}.tar.gz")
    target = default_artifact_path()

    case File.rename(source, target) do
      :ok -> :ok
      {:error, reason} -> {:error, {:artifact_rename_failed, source, target, reason}}
    end
  end

  defp git_commit do
    case System.cmd("git", ["rev-parse", "HEAD"], stderr_to_stdout: true) do
      {commit, 0} -> String.trim(commit)
      _other -> "unknown"
    end
  end
end
