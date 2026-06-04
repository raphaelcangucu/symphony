defmodule SymphonyElixir.Workflow do
  @moduledoc """
  Parses workflow markdown (YAML front matter + prompt body).

  There is no longer a process-global `WORKFLOW.md`: per-project behavior is
  stored as `workflow_markdown` text in the DB (resolved by
  `SymphonyElixir.ProjectConfig`) and process-level settings come from env via
  `SymphonyElixir.InstanceConfig`. The optional `:workflow_file_path` app env is
  a TEST-only injection point for the legacy global front-matter defaults; it is
  never set in production, so `current/0` returns an empty config there.
  """

  @empty_workflow %{config: %{}, prompt: "", prompt_template: ""}

  @spec workflow_file_path() :: Path.t() | nil
  def workflow_file_path do
    Application.get_env(:symphony_elixir, :workflow_file_path)
  end

  @spec set_workflow_file_path(Path.t() | nil) :: :ok
  def set_workflow_file_path(path) when is_binary(path) do
    Application.put_env(:symphony_elixir, :workflow_file_path, path)
    :ok
  end

  # Restoring a previously-unset path (now `nil`) should clear the override rather
  # than crash; this keeps `previous = workflow_file_path(); ...; set(previous)`
  # restore patterns working now that the path can legitimately be `nil`.
  def set_workflow_file_path(nil), do: clear_workflow_file_path()

  @spec clear_workflow_file_path() :: :ok
  def clear_workflow_file_path do
    Application.delete_env(:symphony_elixir, :workflow_file_path)
    :ok
  end

  @type loaded_workflow :: %{
          config: map(),
          prompt: String.t(),
          prompt_template: String.t()
        }

  @spec current() :: {:ok, loaded_workflow()}
  def current do
    case workflow_file_path() do
      path when is_binary(path) ->
        case load(path) do
          {:ok, loaded} -> {:ok, loaded}
          {:error, _reason} -> {:ok, @empty_workflow}
        end

      _ ->
        {:ok, @empty_workflow}
    end
  end

  @spec load() :: {:ok, loaded_workflow()}
  def load do
    current()
  end

  @spec load(Path.t()) :: {:ok, loaded_workflow()} | {:error, term()}
  def load(path) when is_binary(path) do
    case File.read(path) do
      {:ok, content} ->
        parse(content)

      {:error, reason} ->
        {:error, {:missing_workflow_file, path, reason}}
    end
  end

  @doc """
  Parse WORKFLOW markdown text (YAML front matter + prompt body) from a string,
  without touching the filesystem. Used by per-project `workflow_markdown`.
  """
  @spec parse_string(String.t()) :: {:ok, loaded_workflow()} | {:error, term()}
  def parse_string(content) when is_binary(content), do: parse(content)

  @doc """
  Serialize a front-matter map + prompt body into WORKFLOW markdown text. Inverse
  of `parse_string/1` for the structured front matter (round-trips behavior keys;
  comments and key ordering are not preserved).
  """
  @spec to_markdown(map(), String.t()) :: String.t()
  def to_markdown(front_matter, body) when is_map(front_matter) and is_binary(body) do
    if map_size(front_matter) == 0 do
      body
    else
      yaml = front_matter |> stringify_keys() |> Ymlr.document!() |> String.trim_trailing()
      yaml <> "\n---\n\n" <> body
    end
  end

  defp stringify_keys(%{} = map),
    do: Map.new(map, fn {k, v} -> {to_string(k), stringify_keys(v)} end)

  defp stringify_keys(list) when is_list(list), do: Enum.map(list, &stringify_keys/1)
  defp stringify_keys(other), do: other

  defp parse(content) do
    {front_matter_lines, prompt_lines} = split_front_matter(content)

    case front_matter_yaml_to_map(front_matter_lines) do
      {:ok, front_matter} ->
        prompt = Enum.join(prompt_lines, "\n") |> String.trim()

        {:ok,
         %{
           config: front_matter,
           prompt: prompt,
           prompt_template: prompt
         }}

      {:error, :workflow_front_matter_not_a_map} ->
        {:error, :workflow_front_matter_not_a_map}

      {:error, reason} ->
        {:error, {:workflow_parse_error, reason}}
    end
  end

  defp split_front_matter(content) do
    lines = String.split(content, ~r/\R/, trim: false)

    case lines do
      ["---" | tail] ->
        {front, rest} = Enum.split_while(tail, &(&1 != "---"))

        case rest do
          ["---" | prompt_lines] -> {front, prompt_lines}
          _ -> {front, []}
        end

      _ ->
        {[], lines}
    end
  end

  defp front_matter_yaml_to_map(lines) do
    yaml = Enum.join(lines, "\n")

    if String.trim(yaml) == "" do
      {:ok, %{}}
    else
      case YamlElixir.read_from_string(yaml) do
        {:ok, decoded} when is_map(decoded) -> {:ok, decoded}
        {:ok, _} -> {:error, :workflow_front_matter_not_a_map}
        {:error, reason} -> {:error, reason}
      end
    end
  end
end
