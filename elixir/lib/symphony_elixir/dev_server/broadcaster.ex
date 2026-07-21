defmodule SymphonyElixir.DevServer.Broadcaster do
  @moduledoc "Broadcasts dev-server preview status changes to SSE subscribers."

  alias SymphonyElixir.DevServer
  alias SymphonyElixirWeb.DevServerPresenter

  @pubsub SymphonyElixir.PubSub

  @spec topic(String.t(), String.t()) :: String.t()
  def topic(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    "dev_server:#{project_slug}:#{canonical_identifier(identifier)}"
  end

  @spec notify(String.t(), String.t()) :: :ok
  def notify(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    case build_payload(project_slug, identifier) do
      {:ok, payload} ->
        Phoenix.PubSub.broadcast(@pubsub, topic(project_slug, identifier), {:dev_server_update, payload})

      :error ->
        :ok
    end
  end

  def notify(_project_slug, _identifier), do: :ok

  @spec workspace_topic(String.t(), Path.t()) :: String.t()
  def workspace_topic(project_slug, workspace_path)
      when is_binary(project_slug) and is_binary(workspace_path) do
    path_hash =
      :sha256
      |> :crypto.hash(Path.expand(workspace_path))
      |> Base.encode16(case: :lower)

    "dev_server_workspace:#{project_slug}:#{path_hash}"
  end

  @spec notify_workspace(String.t(), Path.t()) :: :ok
  def notify_workspace(project_slug, workspace_path)
      when is_binary(project_slug) and is_binary(workspace_path) do
    workspace_path = Path.expand(workspace_path)

    case build_workspace_payload(project_slug, workspace_path) do
      {:ok, payload} ->
        Phoenix.PubSub.broadcast(
          @pubsub,
          workspace_topic(project_slug, workspace_path),
          {:dev_server_update, payload}
        )

      :error ->
        :ok
    end
  end

  def notify_workspace(_project_slug, _workspace_path), do: :ok

  @spec build_payload(String.t(), String.t()) :: {:ok, map()} | :error
  def build_payload(project_slug, identifier) do
    with {:ok, snapshot} <- DevServer.issue_targets(project_slug, identifier) do
      {:ok, %{data: DevServerPresenter.view(snapshot)}}
    else
      _ -> :error
    end
  end

  @spec build_workspace_payload(String.t(), Path.t()) :: {:ok, map()} | :error
  def build_workspace_payload(project_slug, workspace_path) do
    with {:ok, snapshot} <- DevServer.workspace_targets(project_slug, workspace_path) do
      {:ok, %{data: DevServerPresenter.view(snapshot)}}
    else
      _ -> :error
    end
  end

  defp canonical_identifier(identifier) do
    identifier
    |> String.trim()
    |> String.trim_leading("#")
  end
end
