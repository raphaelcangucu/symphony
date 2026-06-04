defmodule Mix.Tasks.Symphony.Backup do
  @shortdoc "Manage local SQLite tracker backups (create, list, restore, cleanup)"
  @moduledoc """
  Replaces the SEO Machine `cli/backup.py` flow for Symphony's tracker database.

      mix symphony.backup create [--trigger manual]
      mix symphony.backup list [--status completed]
      mix symphony.backup stats
      mix symphony.backup restore <id> [--target PATH]
      mix symphony.backup cleanup
      mix symphony.backup delete <id>
  """

  use Mix.Task

  alias SymphonyElixir.Backup

  @impl Mix.Task
  def run(["create" | rest]) do
    load_config!()
    trigger = option_value(rest, "--trigger") || "manual"

    case Backup.create(trigger: trigger) do
      {:ok, backup} ->
        Mix.shell().info(
          "✓  Backup id=#{backup.id} size=#{Backup.human_bytes(backup.size_bytes)}\n   path: #{backup.local_path}"
        )

      {:error, reason} ->
        Mix.raise("✗  Backup failed: #{inspect(reason)}")
    end
  end

  def run(["list" | rest]) do
    load_config!()
    status = option_value(rest, "--status")
    rows = Backup.list(status: status)

    Mix.shell().info("\nBackups (#{length(rows)}):\n")
    print_table(rows)
  end

  def run(["stats" | _rest]) do
    load_config!()
    stats = Backup.stats()["database"] || %{count: 0, total_bytes: 0, synced_count: 0}

    Mix.shell().info(
      "\nDatabase backups: count=#{stats[:count] || stats["count"]} " <>
        "total=#{Backup.human_bytes(stats[:total_bytes] || stats["total_bytes"] || 0)}\n"
    )
  end

  def run(["restore", id | rest]) do
    load_config!()

    opts =
      case option_value(rest, "--target") do
        nil -> []
        path -> [target: path]
      end

    with {:ok, backup_id} <- parse_id(id),
         {:ok, _} <- Backup.restore(backup_id, opts) do
      Mix.shell().info("✓  Restore completed for backup id=#{backup_id}")
    else
      {:error, :not_found} -> Mix.raise("✗  Backup not found: #{id}")
      {:error, reason} -> Mix.raise("✗  Restore failed: #{inspect(reason)}")
      :error -> Mix.raise("✗  Invalid backup id: #{id}")
    end
  end

  def run(["cleanup" | _rest]) do
    load_config!()
    n = Backup.cleanup_expired()
    Mix.shell().info("✓  Removed #{n} expired backup(s).")
  end

  def run(["delete", id | _rest]) do
    load_config!()

    with {:ok, backup_id} <- parse_id(id),
         :ok <- Backup.delete(backup_id) do
      Mix.shell().info("✓  Deleted backup id=#{backup_id}")
    else
      {:error, :not_found} -> Mix.raise("✗  Backup not found: #{id}")
      :error -> Mix.raise("✗  Invalid backup id: #{id}")
    end
  end

  def run(_argv) do
    Mix.raise("""
    Usage:
      mix symphony.backup create [--trigger manual]
      mix symphony.backup list [--status completed]
      mix symphony.backup stats
      mix symphony.backup restore <id> [--target PATH]
      mix symphony.backup cleanup
      mix symphony.backup delete <id>
    """)
  end

  defp print_table([]), do: Mix.shell().info("  (no backups)")

  defp print_table(rows) do
    Mix.shell().info(
      String.pad_trailing("ID", 4) <>
        "  " <>
        String.pad_trailing("Status", 12) <>
        "  " <>
        String.pad_trailing("Size", 10) <>
        "  " <>
        "Created"
    )

    Enum.each(rows, fn b ->
      Mix.shell().info(
        String.pad_trailing(Integer.to_string(b.id), 4) <>
          "  " <>
          String.pad_trailing(b.status, 12) <>
          "  " <>
          String.pad_trailing(Backup.human_bytes(b.size_bytes), 10) <>
          "  " <>
          DateTime.to_iso8601(b.created_at)
      )
    end)
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

  defp parse_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {int, ""} -> {:ok, int}
      _ -> :error
    end
  end
end
