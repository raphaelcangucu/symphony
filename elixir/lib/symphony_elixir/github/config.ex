defmodule SymphonyElixir.GitHub.Config do
  @moduledoc """
  GitHub-specific configuration read from the `github:` YAML section.
  """

  @behaviour SymphonyElixir.TrackerConfig

  @default_label_prefix "symphony"
  @default_status_field "Symphony State"
  @default_admission_label "symphony"

  @spec repo() :: String.t() | nil
  def repo do
    case section_value("repo") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  @spec token() :: String.t() | nil
  def token do
    normalize_secret(System.get_env("GITHUB_TOKEN"))
  end

  @spec label_prefix() :: String.t()
  def label_prefix do
    case section_value("label_prefix") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> @default_label_prefix
          trimmed -> trimmed
        end

      _ ->
        @default_label_prefix
    end
  end

  @spec project_mode() :: String.t()
  def project_mode do
    case get_in(project_section(), ["mode"]) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> "auto"
          trimmed -> trimmed
        end

      _ ->
        "auto"
    end
  end

  @spec project_title() :: String.t()
  def project_title do
    case get_in(project_section(), ["title"]) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> "Symphony"
          trimmed -> trimmed
        end

      _ ->
        "Symphony"
    end
  end

  @spec project_id() :: String.t() | nil
  def project_id do
    trim_string(get_in(project_section(), ["id"]))
  end

  @spec project_number() :: integer() | nil
  def project_number do
    case get_in(project_section(), ["number"]) do
      n when is_integer(n) ->
        n

      n when is_binary(n) ->
        case Integer.parse(String.trim(n)) do
          {parsed, ""} -> parsed
          _ -> nil
        end

      _ ->
        nil
    end
  end

  @spec status_field() :: String.t()
  def status_field do
    trim_string(section_value("status_field")) || @default_status_field
  end

  @spec admission_label() :: String.t()
  def admission_label do
    trim_string(section_value("admission_label")) || @default_admission_label
  end

  @impl SymphonyElixir.TrackerConfig
  def validate! do
    cond do
      !is_binary(token()) ->
        {:error, "GitHub token missing — set GITHUB_TOKEN env var"}

      !is_binary(repo()) ->
        {:error, "GitHub repo missing — set github.repo in WORKFLOW.md"}

      true ->
        :ok
    end
  end

  defp section_value(key) do
    Map.get(SymphonyElixir.Config.section("github"), key)
  end

  defp project_section do
    case section_value("project") do
      %{} = map -> map
      _ -> %{}
    end
  end

  defp trim_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_string(_value), do: nil

  defp normalize_secret(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_secret(_value), do: nil
end
