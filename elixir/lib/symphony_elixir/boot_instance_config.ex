defmodule SymphonyElixir.BootInstanceConfig do
  @moduledoc false

  alias SymphonyElixir.Workflow

  @default_editor_binary "code-server"
  @default_editor_host "127.0.0.1"
  @default_editor_port 4_002
  @default_editor_auth "none"

  @spec editor_settings() :: keyword()
  def editor_settings do
    workflow = workflow_editor_config()

    [
      editor_enabled: editor_enabled(workflow),
      editor_binary: env_or_workflow("SYMPHONY_EDITOR_BINARY", workflow, "binary", @default_editor_binary),
      editor_host: env_or_workflow("SYMPHONY_EDITOR_HOST", workflow, "host", @default_editor_host),
      editor_port: editor_port(workflow),
      editor_auth: env_or_workflow("SYMPHONY_EDITOR_AUTH", workflow, "auth", @default_editor_auth),
      editor_password: editor_password(workflow),
      editor_base_url: editor_base_url(workflow)
    ]
  end

  defp editor_enabled(workflow) do
    case System.get_env("SYMPHONY_EDITOR_ENABLED") do
      "true" -> true
      "false" -> false
      _ -> workflow_enabled?(workflow)
    end
  end

  defp workflow_enabled?(%{"enabled" => enabled}) when is_boolean(enabled), do: enabled
  defp workflow_enabled?(%{"enabled" => enabled}) when enabled in ["true", "yes", "1"], do: true
  defp workflow_enabled?(%{"enabled" => enabled}) when enabled in ["false", "no", "0"], do: false
  defp workflow_enabled?(_), do: false

  defp editor_port(workflow) do
    case System.get_env("SYMPHONY_EDITOR_PORT") do
      value when is_binary(value) and value != "" ->
        String.to_integer(value)

      _ ->
        case workflow do
          %{"port" => port} when is_integer(port) and port > 0 -> port
          %{"port" => port} when is_binary(port) -> String.to_integer(port)
          _ -> @default_editor_port
        end
    end
  end

  defp editor_password(workflow) do
    case System.get_env("SYMPHONY_EDITOR_PASSWORD") do
      value when is_binary(value) and value != "" -> value
      _ -> blank_to_nil(Map.get(workflow, "password"))
    end
  end

  defp editor_base_url(workflow) do
    case System.get_env("SYMPHONY_EDITOR_BASE_URL") do
      value when is_binary(value) and value != "" -> value
      _ -> blank_to_nil(Map.get(workflow, "base_url"))
    end
  end

  defp env_or_workflow(env_key, workflow, workflow_key, default) do
    case System.get_env(env_key) do
      value when is_binary(value) and value != "" ->
        value

      _ ->
        case Map.get(workflow, workflow_key) do
          value when is_binary(value) and value != "" -> value
          _ -> default
        end
    end
  end

  defp workflow_editor_config do
    case workflow_path() do
      nil ->
        %{}

      path ->
        case File.read(path) do
          {:ok, content} ->
            case Workflow.parse_string(content) do
              {:ok, %{config: %{"editor" => editor}}} when is_map(editor) -> editor
              _ -> %{}
            end

          _ ->
            %{}
        end
    end
  end

  defp workflow_path do
    env = System.get_env("SYMPHONY_WORKFLOW")

    cond do
      is_binary(env) and env != "" and File.exists?(env) ->
        env

      File.exists?("WORKFLOW.md") ->
        "WORKFLOW.md"

      true ->
        nil
    end
  end

  defp blank_to_nil(value) when value in [nil, ""], do: nil
  defp blank_to_nil(value), do: value
end
