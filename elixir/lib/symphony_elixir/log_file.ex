defmodule SymphonyElixir.LogFile do
  @moduledoc """
  Configures OTP's built-in rotating disk log handlers for application logs.

  Two handlers are installed so noisy SQL traffic cannot shrink the main log's
  rotation window (which previously dropped to ~4 minutes and made incident
  debugging impossible):

    * `log/symphony.log` — everything except events tagged with the
      `SymphonyElixir.Observability.SqlLog` domain.
    * `log/symphony.sql.log` — only SQL query events (emitted by `SqlLog`).
  """

  require Logger

  alias SymphonyElixir.Observability.SqlLog

  @handler_id :symphony_disk_log
  @sql_handler_id :symphony_sql_disk_log
  @default_log_relative_path "log/symphony.log"
  @default_max_bytes 10 * 1024 * 1024
  @default_max_files 5

  @spec default_log_file() :: Path.t()
  def default_log_file do
    default_log_file(File.cwd!())
  end

  @spec default_log_file(Path.t()) :: Path.t()
  def default_log_file(logs_root) when is_binary(logs_root) do
    Path.join(logs_root, @default_log_relative_path)
  end

  @doc "SQL log path derived from the main log path (same directory, `.sql.log` suffix)."
  @spec sql_log_file(Path.t()) :: Path.t()
  def sql_log_file(log_file) when is_binary(log_file) do
    Path.join(Path.dirname(log_file), Path.basename(log_file, ".log") <> ".sql.log")
  end

  @spec configure() :: :ok
  def configure do
    log_file = Application.get_env(:symphony_elixir, :log_file, default_log_file())
    max_bytes = Application.get_env(:symphony_elixir, :log_file_max_bytes, @default_max_bytes)
    max_files = Application.get_env(:symphony_elixir, :log_file_max_files, @default_max_files)
    sql_log_file = Application.get_env(:symphony_elixir, :sql_log_file, sql_log_file(log_file))

    setup_disk_handler(log_file, max_bytes, max_files)
    setup_sql_disk_handler(sql_log_file, max_bytes, max_files)
  end

  defp setup_disk_handler(log_file, max_bytes, max_files) do
    config =
      log_file
      |> handler_config(max_bytes, max_files)
      |> Map.put(:filters, [{:no_sql, {&:logger_filters.domain/2, {:stop, :sub, SqlLog.filter_domain()}}}])
      |> Map.put(:filter_default, :log)

    case add_handler(@handler_id, config) do
      :ok ->
        remove_default_console_handler()
        :ok

      {:error, reason} ->
        Logger.warning("Failed to configure rotating log file handler: #{inspect(reason)}")
        :ok
    end
  end

  defp setup_sql_disk_handler(log_file, max_bytes, max_files) do
    config =
      log_file
      |> handler_config(max_bytes, max_files)
      |> Map.put(:filters, [{:sql_only, {&:logger_filters.domain/2, {:log, :sub, SqlLog.filter_domain()}}}])
      |> Map.put(:filter_default, :stop)

    case add_handler(@sql_handler_id, config) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Failed to configure rotating SQL log file handler: #{inspect(reason)}")
        :ok
    end
  end

  defp add_handler(handler_id, config) do
    expanded_path = to_string(get_in(config, [:config, :file]))
    :ok = File.mkdir_p(Path.dirname(expanded_path))
    :ok = remove_existing_handler(handler_id)

    :logger.add_handler(handler_id, :logger_disk_log_h, config)
  end

  defp remove_existing_handler(handler_id) do
    case :logger.remove_handler(handler_id) do
      :ok -> :ok
      {:error, {:not_found, ^handler_id}} -> :ok
      {:error, _reason} -> :ok
    end
  end

  defp remove_default_console_handler do
    case :logger.remove_handler(:default) do
      :ok -> :ok
      {:error, {:not_found, :default}} -> :ok
      {:error, _reason} -> :ok
    end
  end

  defp handler_config(path, max_bytes, max_files) do
    %{
      level: :all,
      formatter: {:logger_formatter, %{single_line: true}},
      config: %{
        file: path |> Path.expand() |> String.to_charlist(),
        type: :wrap,
        max_no_bytes: max_bytes,
        max_no_files: max_files
      }
    }
  end
end
