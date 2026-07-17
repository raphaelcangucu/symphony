defmodule Mix.Tasks.Symphony.MigrateSessionLogs do
  @shortdoc "Seed per-session transcript files from shared workspace logs"
  @moduledoc """
  Copies each Thread's shared working-tree agent log into
  `.symphony/sessions/<thread_id>/transcript.jsonl` when that file is missing.

  The same work also runs automatically via the Ecto data migration
  `SeedPerSessionTranscripts` on the next `mix ecto.migrate`. This Mix task
  remains for dry-runs and project-scoped re-runs; both paths are idempotent.

      mix symphony.migrate_session_logs
      mix symphony.migrate_session_logs --dry-run
      mix symphony.migrate_session_logs --project advising
  """

  use Mix.Task

  alias SymphonyElixir.Agent.SessionLogMigrator

  @impl Mix.Task
  def run(argv) when is_list(argv) do
    load_config!()
    Mix.Task.run("app.start")

    opts = parse_opts(argv)
    result = SessionLogMigrator.migrate(opts)

    Mix.shell().info(
      "Session log migration complete: " <>
        "migrated=#{result.migrated} skipped=#{result.skipped} errors=#{result.errors}"
    )
  end

  defp parse_opts(argv) do
    {dry_run?, rest} = pop_flag(argv, "--dry-run")
    project_slug = option_value(rest, "--project")

    []
    |> then(fn opts -> if dry_run?, do: Keyword.put(opts, :dry_run, true), else: opts end)
    |> then(fn opts ->
      if is_binary(project_slug) and String.trim(project_slug) != "" do
        Keyword.put(opts, :project_slug, String.trim(project_slug))
      else
        opts
      end
    end)
  end

  defp pop_flag(argv, flag) do
    if flag in argv do
      {true, List.delete(argv, flag)}
    else
      {false, argv}
    end
  end

  defp option_value(argv, flag) do
    case Enum.split_while(argv, &(&1 != flag)) do
      {_, [^flag, value | _]} -> value
      _ -> nil
    end
  end

  defp load_config! do
    load_dotenv!()
    Mix.Task.run("app.config")

    case Application.load(:symphony_elixir) do
      :ok -> :ok
      {:error, {:already_loaded, :symphony_elixir}} -> :ok
      {:error, reason} -> Mix.raise("could not load symphony_elixir: #{inspect(reason)}")
    end
  end

  defp load_dotenv! do
    env_path = Path.join(File.cwd!(), ".env")

    if File.regular?(env_path) do
      env_path
      |> File.read!()
      |> String.split("\n", trim: false)
      |> Enum.each(&import_env_line/1)
    end
  end

  defp import_env_line(line) do
    line = String.trim(line)

    cond do
      line == "" or String.starts_with?(line, "#") ->
        :ok

      true ->
        case String.split(line, "=", parts: 2) do
          [key, value] ->
            System.put_env(String.trim(key), String.trim(value))

          _ ->
            :ok
        end
    end
  end
end
