defmodule SymphonyElixir.Terminal.TabStore do
  @moduledoc """
  In-memory store for dynamic issue terminal tab metadata.
  """

  use GenServer

  @type tab :: %{
          id: String.t(),
          project_slug: String.t(),
          issue_identifier: String.t(),
          title: String.t(),
          cwd: String.t(),
          command: String.t() | nil,
          session_name: String.t(),
          state: String.t()
        }

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @spec list(String.t(), String.t()) :: [tab()]
  def list(project_slug, issue_identifier) when is_binary(project_slug) and is_binary(issue_identifier) do
    GenServer.call(__MODULE__, {:list, project_slug, issue_identifier})
  end

  @spec get(String.t(), String.t()) :: {:ok, tab()} | {:error, :not_found}
  def get(project_slug, tab_id) when is_binary(project_slug) and is_binary(tab_id) do
    GenServer.call(__MODULE__, {:get, project_slug, tab_id})
  end

  @spec put(tab()) :: :ok
  def put(tab) when is_map(tab), do: GenServer.call(__MODULE__, {:put, tab})

  @spec rename(String.t(), String.t(), String.t(), String.t()) :: {:ok, tab()} | {:error, :not_found}
  def rename(project_slug, issue_identifier, tab_id, title)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(tab_id) and is_binary(title) do
    GenServer.call(__MODULE__, {:rename, project_slug, issue_identifier, tab_id, title})
  end

  @spec delete(String.t(), String.t(), String.t()) :: :ok | {:error, :not_found}
  def delete(project_slug, issue_identifier, tab_id)
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(tab_id) do
    GenServer.call(__MODULE__, {:delete, project_slug, issue_identifier, tab_id})
  end

  @impl true
  def init(_opts), do: {:ok, %{}}

  @impl true
  def handle_call({:list, project_slug, issue_identifier}, _from, state) do
    tabs =
      state
      |> Map.values()
      |> Enum.filter(fn tab ->
        tab.project_slug == project_slug and tab.issue_identifier == issue_identifier
      end)
      |> Enum.sort_by(& &1.id)

    {:reply, tabs, state}
  end

  def handle_call({:get, project_slug, tab_id}, _from, state) do
    {:reply, fetch(state, key(project_slug, tab_id)), state}
  end

  def handle_call({:put, tab}, _from, state) do
    next = Map.put(state, key(tab.project_slug, tab.id), tab)
    {:reply, :ok, next}
  end

  def handle_call({:rename, project_slug, issue_identifier, tab_id, title}, _from, state) do
    case fetch(state, key(project_slug, tab_id)) do
      {:ok, tab} ->
        if tab.issue_identifier != issue_identifier do
          {:reply, {:error, :not_found}, state}
        else
          updated = %{tab | title: String.trim(title)}
          next = Map.put(state, key(project_slug, tab_id), updated)
          {:reply, {:ok, updated}, next}
        end

      {:error, :not_found} = missing ->
        {:reply, missing, state}
    end
  end

  def handle_call({:delete, project_slug, issue_identifier, tab_id}, _from, state) do
    case fetch(state, key(project_slug, tab_id)) do
      {:ok, tab} ->
        if tab.issue_identifier != issue_identifier do
          {:reply, {:error, :not_found}, state}
        else
          {:reply, :ok, Map.delete(state, key(project_slug, tab_id))}
        end

      {:error, :not_found} = missing ->
        {:reply, missing, state}
    end
  end

  defp key(project_slug, tab_id), do: {project_slug, tab_id}

  defp fetch(state, lookup_key) do
    case Map.get(state, lookup_key) do
      nil -> {:error, :not_found}
      tab -> {:ok, tab}
    end
  end
end
