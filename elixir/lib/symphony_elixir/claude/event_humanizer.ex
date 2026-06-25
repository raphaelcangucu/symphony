defmodule SymphonyElixir.Claude.EventHumanizer do
  @moduledoc """
  Humanizes Claude Code app-server event messages for the status dashboard.

  Claude app-server emits these notification methods:
    - item/created   — a new item (text, thinking, tool_call, tool_result)
    - item/progress  — streaming delta for an in-progress item
    - turn/started   — turn execution has begun
    - turn/completed — turn finished successfully
    - turn/failed    — turn ended with an error
    - turn/permission_denied — a tool call was denied by permission mode
  """

  @behaviour SymphonyElixir.EventHumanizer

  import SymphonyElixir.EventHumanizerHelpers

  alias SymphonyElixir.EventHumanizer.Text, as: T

  @impl true
  def humanize_method("item/created", payload) do
    item =
      map_path(payload, ["params", "item"]) ||
        map_path(payload, [:params, :item]) ||
        %{}

    humanize_created_item(item)
  end

  def humanize_method("item/progress", payload) do
    delta =
      map_path(payload, ["params", "delta"]) ||
        map_path(payload, [:params, :delta]) ||
        %{}

    delta_type = map_value(delta, ["type", :type])

    case delta_type do
      "text" ->
        text = map_value(delta, ["text", :text])
        preview = if is_binary(text), do: ": #{inline_text(text)}", else: ""
        T.t("streaming%{preview}", preview: preview)

      "thinking" ->
        T.t("thinking...")

      _ ->
        T.t("streaming...")
    end
  end

  def humanize_method("turn/started", payload) do
    turn_id =
      map_path(payload, ["params", "turn_id"]) ||
        map_path(payload, [:params, :turn_id])

    if is_binary(turn_id),
      do: T.t("turn started (%{id})", id: short_id(turn_id)),
      else: T.t("turn started")
  end

  def humanize_method("turn/completed", payload) do
    status =
      map_path(payload, ["params", "status"]) ||
        map_path(payload, [:params, :status]) ||
        "completed"

    items_count =
      map_path(payload, ["params", "items_count"]) ||
        map_path(payload, [:params, :items_count])

    count_suffix =
      if is_integer(items_count),
        do: T.t(", %{count} items", count: items_count),
        else: ""

    T.t("turn completed (%{status}%{count_suffix})", status: status, count_suffix: count_suffix)
  end

  def humanize_method("turn/failed", payload) do
    error =
      map_path(payload, ["params", "error"]) ||
        map_path(payload, [:params, :error])

    if is_binary(error),
      do: T.t("turn failed: %{error}", error: inline_text(error)),
      else: T.t("turn failed")
  end

  def humanize_method("turn/permission_denied", payload) do
    denials =
      map_path(payload, ["params", "denials"]) ||
        map_path(payload, [:params, :denials]) ||
        []

    case denials do
      [first | _] ->
        tool = map_value(first, ["tool_name", :tool_name])
        count = length(denials)
        tool_text = if is_binary(tool), do: tool, else: T.t("unknown")

        if count > 1 do
          T.t("permission denied: %{tool} (+%{more} more)", tool: tool_text, more: count - 1)
        else
          T.t("permission denied: %{tool}", tool: tool_text)
        end

      _ ->
        T.t("permission denied")
    end
  end

  def humanize_method("initialized", _payload), do: T.t("server initialized")

  def humanize_method(method, _payload), do: method

  defp humanize_created_item(item) do
    case map_value(item, ["type", :type]) do
      "text" -> with_preview(T.t("agent message"), map_value(item, ["text", :text]))
      "thinking" -> with_preview(T.t("thinking"), map_value(item, ["thinking", :thinking]))
      "tool_call" -> humanize_tool_call(item)
      "tool_result" -> humanize_tool_result(item)
      nil -> T.t("item created")
      other -> T.t("item created: %{type}", type: humanize_item_type(other))
    end
  end

  defp with_preview(label, text) when is_binary(text), do: "#{label}: #{inline_text(text)}"
  defp with_preview(label, _text), do: label

  defp humanize_tool_call(item) do
    name = map_value(item, ["name", :name])
    if is_binary(name), do: T.t("tool call: %{name}", name: name), else: T.t("tool call")
  end

  defp humanize_tool_result(item) do
    tool_id = map_value(item, ["tool_use_id", :tool_use_id])
    is_error = map_value(item, ["is_error", :is_error])
    status = if is_error, do: T.t("error"), else: T.t("ok")
    id_suffix = if is_binary(tool_id), do: " (#{short_id(tool_id)})", else: ""
    T.t("tool result: %{status}%{id_suffix}", status: status, id_suffix: id_suffix)
  end
end
