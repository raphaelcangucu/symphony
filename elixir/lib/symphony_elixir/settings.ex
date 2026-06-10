defmodule SymphonyElixir.Settings do
  @moduledoc """
  Generic key-value settings store mirroring spatie/laravel-settings:
  rows live in the `settings` table keyed by (group, name); group modules
  declare defaults and casts in code. Reads merge stored rows over
  defaults; a missing or corrupt row yields the default.
  """

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @groups %{
    "agents" => SymphonyElixir.Settings.Agents,
    "orchestrator" => SymphonyElixir.Settings.Orchestration
  }

  @spec groups() :: %{String.t() => module()}
  def groups, do: @groups

  @spec get(String.t(), String.t()) :: term()
  def get(group, name) when is_binary(group) and is_binary(name) do
    with {:ok, module} <- fetch_group(group),
         %{} = defaults <- module.defaults(),
         {:ok, default} <- Map.fetch(defaults, name) do
      case stored_value(group, name) do
        {:ok, value} ->
          case module.cast(name, value) do
            {:ok, cast} -> cast
            :error -> default
          end

        :missing ->
          default
      end
    else
      _ -> nil
    end
  end

  @spec get_group(String.t()) :: %{String.t() => term()} | nil
  def get_group(group) when is_binary(group) do
    case fetch_group(group) do
      {:ok, module} ->
        module.defaults()
        |> Map.new(fn {name, _default} -> {name, get(group, name)} end)

      :error ->
        nil
    end
  end

  @spec all() :: %{String.t() => %{String.t() => term()}}
  def all do
    Map.new(@groups, fn {group, _module} -> {group, get_group(group)} end)
  end

  @spec put(String.t(), String.t(), term()) ::
          {:ok, term()} | {:error, :unknown_group | :unknown_setting | :invalid_value | Ecto.Changeset.t()}
  def put(group, name, value) when is_binary(group) and is_binary(name) do
    with {:ok, module} <- fetch_group_or(group, :unknown_group),
         {:ok, _default} <- fetch_default_or(module, name, :unknown_setting),
         {:ok, cast} <- cast_or(module, name, value, :invalid_value) do
      %Setting{}
      |> Setting.changeset(%{group: group, name: name, payload: %{"value" => cast}})
      |> Repo.insert(
        on_conflict: {:replace, [:payload, :updated_at]},
        conflict_target: [:group, :name]
      )
      |> case do
        {:ok, _setting} -> {:ok, cast}
        {:error, changeset} -> {:error, changeset}
      end
    end
  end

  defp stored_value(group, name) do
    query = from(s in Setting, where: s.group == ^group and s.name == ^name)

    case Repo.one(query) do
      %Setting{payload: %{"value" => value}} -> {:ok, value}
      _ -> :missing
    end
  rescue
    # Graceful degradation when migrations have not run yet (e.g. long-lived serve
    # processes started before a settings-table migration shipped).
    _ -> :missing
  end

  defp fetch_group(group), do: Map.fetch(@groups, group) |> ok_or_error()

  defp fetch_group_or(group, error) do
    case fetch_group(group) do
      {:ok, module} -> {:ok, module}
      :error -> {:error, error}
    end
  end

  defp fetch_default_or(module, name, error) do
    case Map.fetch(module.defaults(), name) do
      {:ok, default} -> {:ok, default}
      :error -> {:error, error}
    end
  end

  defp cast_or(module, name, value, error) do
    case module.cast(name, value) do
      {:ok, cast} -> {:ok, cast}
      :error -> {:error, error}
    end
  end

  defp ok_or_error({:ok, value}), do: {:ok, value}
  defp ok_or_error(:error), do: :error
end
