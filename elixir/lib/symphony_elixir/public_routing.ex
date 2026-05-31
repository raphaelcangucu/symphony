defmodule SymphonyElixir.PublicRouting do
  @moduledoc """
  Maps public preview hostnames to local dev-server ports and builds the
  per-namespace hostnames used by the public tunnel.
  """

  use GenServer

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Viewer

  @table __MODULE__
  @max_label_len 63

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @spec register(String.t(), pos_integer()) :: :ok
  def register(host, port) when is_binary(host) and is_integer(port) do
    GenServer.call(__MODULE__, {:register, host, port})
  end

  @spec unregister(String.t()) :: :ok
  def unregister(host) when is_binary(host) do
    GenServer.call(__MODULE__, {:unregister, host})
  end

  @spec lookup(String.t()) :: {:ok, pos_integer()} | :error
  def lookup(host) when is_binary(host) do
    case :ets.lookup(@table, host) do
      [{^host, port}] -> {:ok, port}
      _ -> :error
    end
  end

  @spec sanitize_label(String.t()) :: String.t()
  def sanitize_label(value) when is_binary(value) do
    value
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/u, "-")
    |> String.replace(~r/-+/, "-")
    |> String.trim("-")
  end

  @spec host_for(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def host_for(project_slug, identifier, step_slug, opts) do
    with {:ok, namespace} <- fetch_namespace(opts) do
      base_domain = fetch_base_domain(opts)

      label =
        [project_slug, strip_hash(identifier), step_slug]
        |> Enum.map(&sanitize_label/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("-")
        |> enforce_label_limit()

      {:ok, "#{label}.#{namespace}.#{base_domain}"}
    end
  end

  @spec tracker_host(keyword()) :: String.t()
  def tracker_host(opts) do
    {:ok, namespace} = fetch_namespace(opts)
    "#{namespace}.#{fetch_base_domain(opts)}"
  end

  @spec namespace_suffix(keyword()) :: String.t()
  def namespace_suffix(opts) do
    {:ok, namespace} = fetch_namespace(opts)
    ".#{namespace}.#{fetch_base_domain(opts)}"
  end

  @spec preview_host(String.t(), String.t(), String.t(), keyword()) :: String.t() | nil
  def preview_host(project_slug, identifier, step_slug, opts \\ []) do
    if Config.public_tunnel_enabled?() do
      case host_for(project_slug, identifier, step_slug, opts) do
        {:ok, host} -> host
        {:error, _reason} -> nil
      end
    else
      nil
    end
  end

  @spec resolve_namespace(keyword()) :: {:ok, String.t()} | {:error, :no_namespace}
  def resolve_namespace(opts \\ []) do
    case Config.public_tunnel_namespace() do
      ns when is_binary(ns) and ns != "" ->
        {:ok, sanitize_label(ns)}

      _ ->
        viewer = Keyword.get(opts, :viewer, &Viewer.current/0)

        case viewer.() do
          {:ok, %{login: login}} when is_binary(login) and login != "" ->
            {:ok, sanitize_label(login)}

          _ ->
            {:error, :no_namespace}
        end
    end
  end

  @impl true
  def init(_opts) do
    table = :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    {:ok, %{table: table}}
  end

  @impl true
  def handle_call({:register, host, port}, _from, state) do
    :ets.insert(state.table, {host, port})
    {:reply, :ok, state}
  end

  def handle_call({:unregister, host}, _from, state) do
    :ets.delete(state.table, host)
    {:reply, :ok, state}
  end

  defp fetch_namespace(opts) do
    case Keyword.get(opts, :namespace) do
      ns when is_binary(ns) and ns != "" -> {:ok, sanitize_label(ns)}
      _ -> resolve_namespace(opts)
    end
  end

  defp fetch_base_domain(opts) do
    Keyword.get(opts, :base_domain) || Config.public_tunnel_base_domain()
  end

  defp strip_hash(identifier) when is_binary(identifier), do: String.trim_leading(identifier, "#")

  defp enforce_label_limit(label) when byte_size(label) <= @max_label_len, do: label

  defp enforce_label_limit(label) do
    hash = label |> :erlang.md5() |> Base.encode16(case: :lower) |> binary_part(0, 8)
    keep = @max_label_len - byte_size(hash) - 1
    "#{binary_part(label, 0, keep)}-#{hash}"
  end
end
