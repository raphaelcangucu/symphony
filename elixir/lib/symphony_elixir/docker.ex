defmodule SymphonyElixir.Docker do
  @moduledoc """
  Thin wrapper around the local Docker CLI used by the tracker Docker dashboard.

  Shell access goes through a runner function of type
  `([String.t()] -> {String.t(), integer()})` injectable via the
  `:docker_runner` application env so tests never touch a real daemon.

  Known limitation: compose labels are parsed from Docker's comma-joined label
  string, so label values containing commas are truncated at the comma.
  """

  @compose_project_label "com.docker.compose.project"
  @compose_working_dir_label "com.docker.compose.project.working_dir"

  @action_args %{
    "start" => ["start"],
    "stop" => ["stop"],
    "restart" => ["restart"],
    "remove" => ["rm"]
  }

  @container_id_pattern ~r/^[A-Fa-f0-9]{12,64}$/

  @type container :: %{
          id: String.t(),
          name: String.t(),
          image: String.t(),
          state: String.t(),
          status: String.t(),
          ports: String.t(),
          created_at: String.t(),
          compose_project: String.t() | nil,
          compose_working_dir: String.t() | nil,
          cpu_percent: String.t() | nil,
          memory_usage: String.t() | nil
        }

  @spec list_containers() :: {:ok, [container()]} | {:error, String.t()}
  def list_containers do
    with {:ok, ps_rows} <- docker_json_lines(["ps", "-a", "--no-trunc", "--format", "{{json .}}"]),
         {:ok, stats_rows} <-
           docker_json_lines(["stats", "--no-stream", "--no-trunc", "--format", "{{json .}}"]) do
      stats_by_id = Map.new(stats_rows, fn row -> {row["ID"] || row["Container"], row} end)
      {:ok, Enum.map(ps_rows, &build_container(&1, stats_by_id))}
    end
  end

  @spec container_action(String.t(), String.t(), keyword()) ::
          :ok | {:error, :invalid_container_id | :invalid_action | String.t()}
  def container_action(id, action, opts \\ []) do
    cond do
      not (is_binary(id) and Regex.match?(@container_id_pattern, id)) ->
        {:error, :invalid_container_id}

      not Map.has_key?(@action_args, action) ->
        {:error, :invalid_action}

      true ->
        run_action(id, action, Keyword.get(opts, :force, false))
    end
  end

  defp run_action(id, action, force) do
    base = Map.fetch!(@action_args, action)
    args = if action == "remove" and force, do: base ++ ["--force"], else: base

    case run(args ++ [id]) do
      {_output, 0} -> :ok
      {output, _code} -> {:error, String.trim(output)}
    end
  end

  defp docker_json_lines(args) do
    case run(args) do
      {output, 0} -> {:ok, parse_json_lines(output)}
      {output, _code} -> {:error, String.trim(output)}
    end
  end

  defp parse_json_lines(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.flat_map(fn line ->
      case Jason.decode(line) do
        {:ok, row} when is_map(row) -> [row]
        _ -> []
      end
    end)
  end

  defp build_container(ps_row, stats_by_id) do
    labels = parse_labels(ps_row["Labels"])
    stats = Map.get(stats_by_id, ps_row["ID"], %{})

    %{
      id: ps_row["ID"] || "",
      name: ps_row["Names"] || "",
      image: ps_row["Image"] || "",
      state: ps_row["State"] || "",
      status: ps_row["Status"] || "",
      ports: ps_row["Ports"] || "",
      created_at: ps_row["CreatedAt"] || "",
      compose_project: labels[@compose_project_label],
      compose_working_dir: labels[@compose_working_dir_label],
      cpu_percent: stats["CPUPerc"],
      memory_usage: stats["MemUsage"]
    }
  end

  defp parse_labels(labels) when is_binary(labels) do
    labels
    |> String.split(",")
    |> Enum.reduce(%{}, fn pair, acc ->
      case String.split(pair, "=", parts: 2) do
        [key, value] when value != "" -> Map.put(acc, key, value)
        _ -> acc
      end
    end)
  end

  defp parse_labels(_labels), do: %{}

  defp run(args) do
    runner = Application.get_env(:symphony_elixir, :docker_runner, &default_runner/1)
    runner.(args)
  end

  defp default_runner(args) do
    System.cmd("docker", args, stderr_to_stdout: true)
  rescue
    _error -> {"docker CLI is not available on this host", 127}
  end
end
