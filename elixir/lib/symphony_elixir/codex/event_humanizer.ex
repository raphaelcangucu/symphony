defmodule SymphonyElixir.Codex.EventHumanizer do
  @moduledoc """
  Humanizes Codex app-server event messages for the status dashboard.
  """

  @behaviour SymphonyElixir.EventHumanizer

  import SymphonyElixir.EventHumanizerHelpers

  alias SymphonyElixir.EventHumanizer.Text, as: T

  @impl true
  def humanize_method("thread/started", payload) do
    thread_id = map_path(payload, ["params", "thread", "id"]) || map_path(payload, [:params, :thread, :id])

    if is_binary(thread_id),
      do: T.t("thread started (%{id})", id: thread_id),
      else: T.t("thread started")
  end

  def humanize_method("turn/started", payload) do
    turn_id = map_path(payload, ["params", "turn", "id"]) || map_path(payload, [:params, :turn, :id])

    if is_binary(turn_id),
      do: T.t("turn started (%{id})", id: turn_id),
      else: T.t("turn started")
  end

  def humanize_method("turn/completed", payload) do
    status =
      map_path(payload, ["params", "turn", "status"]) ||
        map_path(payload, [:params, :turn, :status]) ||
        "completed"

    usage =
      map_path(payload, ["params", "usage"]) ||
        map_path(payload, [:params, :usage]) ||
        map_path(payload, ["params", "tokenUsage"]) ||
        map_path(payload, [:params, :tokenUsage]) ||
        map_value(payload, ["usage", :usage])

    usage_suffix =
      case format_usage_counts(usage) do
        nil -> ""
        usage_text -> " (#{usage_text})"
      end

    T.t("turn completed (%{status})%{usage_suffix}", status: status, usage_suffix: usage_suffix)
  end

  def humanize_method("turn/failed", payload) do
    error_message =
      map_path(payload, ["params", "error", "message"]) ||
        map_path(payload, [:params, :error, :message])

    if is_binary(error_message),
      do: T.t("turn failed: %{message}", message: error_message),
      else: T.t("turn failed")
  end

  def humanize_method("turn/cancelled", _payload), do: T.t("turn cancelled")

  def humanize_method("turn/diff/updated", payload) do
    diff =
      map_path(payload, ["params", "diff"]) ||
        map_path(payload, [:params, :diff]) ||
        ""

    if is_binary(diff) and diff != "" do
      line_count = diff |> String.split("\n", trim: true) |> length()
      T.t("turn diff updated (%{count} lines)", count: line_count)
    else
      T.t("turn diff updated")
    end
  end

  def humanize_method("turn/plan/updated", payload) do
    plan_entries =
      map_path(payload, ["params", "plan"]) ||
        map_path(payload, [:params, :plan]) ||
        map_path(payload, ["params", "steps"]) ||
        map_path(payload, [:params, :steps]) ||
        map_path(payload, ["params", "items"]) ||
        map_path(payload, [:params, :items]) ||
        []

    if is_list(plan_entries),
      do: T.t("plan updated (%{count} steps)", count: length(plan_entries)),
      else: T.t("plan updated")
  end

  def humanize_method("thread/tokenUsage/updated", payload) do
    usage =
      map_path(payload, ["params", "tokenUsage", "total"]) ||
        map_path(payload, [:params, :tokenUsage, :total]) ||
        map_value(payload, ["usage", :usage])

    case format_usage_counts(usage) do
      nil -> T.t("thread token usage updated")
      usage_text -> T.t("thread token usage updated (%{usage})", usage: usage_text)
    end
  end

  def humanize_method("item/started", payload), do: humanize_item_lifecycle("started", payload)
  def humanize_method("item/completed", payload), do: humanize_item_lifecycle("completed", payload)

  def humanize_method("item/agentMessage/delta", payload),
    do: humanize_streaming_event(T.t("agent message streaming"), payload)

  def humanize_method("item/plan/delta", payload),
    do: humanize_streaming_event(T.t("plan streaming"), payload)

  def humanize_method("item/reasoning/summaryTextDelta", payload),
    do: humanize_streaming_event(T.t("reasoning summary streaming"), payload)

  def humanize_method("item/reasoning/summaryPartAdded", payload),
    do: humanize_streaming_event(T.t("reasoning summary section added"), payload)

  def humanize_method("item/reasoning/textDelta", payload),
    do: humanize_streaming_event(T.t("reasoning text streaming"), payload)

  def humanize_method("item/commandExecution/outputDelta", payload),
    do: humanize_streaming_event(T.t("command output streaming"), payload)

  def humanize_method("item/fileChange/outputDelta", payload),
    do: humanize_streaming_event(T.t("file change output streaming"), payload)

  def humanize_method("item/commandExecution/requestApproval", payload) do
    command = extract_command(payload)

    if is_binary(command),
      do: T.t("command approval requested (%{command})", command: command),
      else: T.t("command approval requested")
  end

  def humanize_method("item/fileChange/requestApproval", payload) do
    change_count = map_path(payload, ["params", "fileChangeCount"]) || map_path(payload, ["params", "changeCount"])

    if is_integer(change_count) and change_count > 0 do
      T.t("file change approval requested (%{count} files)", count: change_count)
    else
      T.t("file change approval requested")
    end
  end

  def humanize_method("item/tool/requestUserInput", payload) do
    question =
      map_path(payload, ["params", "question"]) ||
        map_path(payload, ["params", "prompt"]) ||
        map_path(payload, [:params, :question]) ||
        map_path(payload, [:params, :prompt])

    if is_binary(question) and String.trim(question) != "" do
      T.t("tool requires user input: %{question}", question: inline_text(question))
    else
      T.t("tool requires user input")
    end
  end

  def humanize_method("tool/requestUserInput", payload),
    do: humanize_method("item/tool/requestUserInput", payload)

  def humanize_method("account/updated", payload) do
    auth_mode =
      map_path(payload, ["params", "authMode"]) ||
        map_path(payload, [:params, :authMode]) ||
        T.t("unknown")

    T.t("account updated (auth %{mode})", mode: auth_mode)
  end

  def humanize_method("account/rateLimits/updated", payload) do
    rate_limits =
      map_path(payload, ["params", "rateLimits"]) ||
        map_path(payload, [:params, :rateLimits])

    T.t("rate limits updated: %{summary}", summary: format_rate_limits_summary(rate_limits))
  end

  def humanize_method("account/chatgptAuthTokens/refresh", _payload),
    do: T.t("account auth token refresh requested")

  def humanize_method("item/tool/call", payload) do
    tool = dynamic_tool_name(payload)

    if is_binary(tool) and String.trim(tool) != "" do
      T.t("dynamic tool call requested (%{tool})", tool: tool)
    else
      T.t("dynamic tool call requested")
    end
  end

  def humanize_method(<<"codex/event/", suffix::binary>>, payload) do
    humanize_wrapper_event(suffix, payload)
  end

  def humanize_method(method, payload) do
    msg_type =
      map_path(payload, ["params", "msg", "type"]) ||
        map_path(payload, [:params, :msg, :type])

    if is_binary(msg_type),
      do: T.t("%{method} (%{msg_type})", method: method, msg_type: msg_type),
      else: method
  end

  defp humanize_item_lifecycle(state, payload) do
    item =
      map_path(payload, ["params", "item"]) ||
        map_path(payload, [:params, :item]) ||
        %{}

    item_type = item |> map_value(["type", :type]) |> humanize_item_type()
    item_status = map_value(item, ["status", :status])
    item_id = map_value(item, ["id", :id])

    details =
      []
      |> append_if_present(short_id(item_id))
      |> append_if_present(humanize_status(item_status))

    detail_suffix = if details == [], do: "", else: " (#{Enum.join(details, ", ")})"
    T.t("item %{state}: %{type}%{suffix}", state: state, type: item_type, suffix: detail_suffix)
  end

  defp humanize_streaming_event(label, payload) do
    case extract_delta_preview(payload) do
      nil -> label
      preview -> "#{label}: #{preview}"
    end
  end

  defp extract_delta_preview(payload) do
    delta = extract_first_path(payload, delta_paths())

    case delta do
      value when is_binary(value) ->
        trimmed = String.trim(value)
        if trimmed == "", do: nil, else: inline_text(trimmed)

      _ ->
        nil
    end
  end

  defp extract_command(payload) do
    payload
    |> map_path(["params", "parsedCmd"])
    |> fallback_command(payload)
    |> normalize_command()
  end

  defp fallback_command(nil, payload) do
    map_path(payload, ["params", "command"]) ||
      map_path(payload, ["params", "cmd"]) ||
      map_path(payload, ["params", "argv"]) ||
      map_path(payload, ["params", "args"])
  end

  defp fallback_command(command, _payload), do: command

  defp normalize_command(%{} = command) do
    binary_command = map_value(command, ["parsedCmd", :parsedCmd, "command", :command, "cmd", :cmd])
    args = map_value(command, ["args", :args, "argv", :argv])

    if is_binary(binary_command) and is_list(args) do
      normalize_command([binary_command | args])
    else
      normalize_command(binary_command || args)
    end
  end

  defp normalize_command(command) when is_binary(command), do: inline_text(command)

  defp normalize_command(command) when is_list(command) do
    if Enum.all?(command, &is_binary/1) do
      command |> Enum.join(" ") |> inline_text()
    else
      nil
    end
  end

  defp normalize_command(_command), do: nil

  defp dynamic_tool_name(payload) do
    map_path(payload, ["params", "tool"]) ||
      map_path(payload, ["params", "name"]) ||
      map_path(payload, [:params, :tool]) ||
      map_path(payload, [:params, :name])
  end

  defp format_usage_counts(usage) when is_map(usage) do
    input =
      parse_integer(
        map_value(usage, [
          "input_tokens",
          :input_tokens,
          "prompt_tokens",
          :prompt_tokens,
          "inputTokens",
          :inputTokens,
          "promptTokens",
          :promptTokens
        ])
      )

    output =
      parse_integer(
        map_value(usage, [
          "output_tokens",
          :output_tokens,
          "completion_tokens",
          :completion_tokens,
          "outputTokens",
          :outputTokens,
          "completionTokens",
          :completionTokens
        ])
      )

    total =
      parse_integer(
        map_value(usage, [
          "total_tokens",
          :total_tokens,
          "total",
          :total,
          "totalTokens",
          :totalTokens
        ])
      )

    parts =
      []
      |> append_usage_part(T.t("in"), input)
      |> append_usage_part(T.t("out"), output)
      |> append_usage_part(T.t("total"), total)

    case parts do
      [] -> nil
      _ -> Enum.join(parts, ", ")
    end
  end

  defp format_usage_counts(_usage), do: nil

  defp append_usage_part(parts, _label, value) when not is_integer(value), do: parts
  defp append_usage_part(parts, label, value), do: parts ++ ["#{label} #{format_count(value)}"]

  defp format_rate_limits_summary(nil), do: T.t("n/a")

  defp format_rate_limits_summary(rate_limits) when is_map(rate_limits) do
    primary = map_value(rate_limits, ["primary", :primary])
    secondary = map_value(rate_limits, ["secondary", :secondary])
    primary_text = format_rate_limit_bucket(primary)
    secondary_text = format_rate_limit_bucket(secondary)

    cond do
      primary_text != nil and secondary_text != nil ->
        T.t("primary %{primary}; secondary %{secondary}", primary: primary_text, secondary: secondary_text)

      primary_text != nil ->
        T.t("primary %{primary}", primary: primary_text)

      secondary_text != nil ->
        T.t("secondary %{secondary}", secondary: secondary_text)

      true ->
        T.t("n/a")
    end
  end

  defp format_rate_limits_summary(_rate_limits), do: T.t("n/a")

  defp format_rate_limit_bucket(bucket) when is_map(bucket) do
    used_percent = map_value(bucket, ["usedPercent", :usedPercent])
    window_mins = map_value(bucket, ["windowDurationMins", :windowDurationMins])

    cond do
      is_number(used_percent) and is_integer(window_mins) ->
        T.t("%{percent}% / %{mins}m", percent: used_percent, mins: window_mins)

      is_number(used_percent) ->
        T.t("%{percent}% used", percent: used_percent)

      true ->
        nil
    end
  end

  defp format_rate_limit_bucket(_bucket), do: nil

  defp humanize_status(status) when is_binary(status) do
    status |> String.replace("_", " ") |> String.replace("-", " ") |> String.downcase() |> String.trim()
  end

  defp humanize_status(_status), do: nil

  defp append_if_present(list, value) when is_binary(value) and value != "", do: list ++ [value]
  defp append_if_present(list, _value), do: list

  defp extract_first_path(payload, paths) do
    Enum.find_value(paths, fn path -> map_path(payload, path) end)
  end

  defp delta_paths do
    [
      ["params", "delta"],
      [:params, :delta],
      ["params", "msg", "delta"],
      [:params, :msg, :delta],
      ["params", "textDelta"],
      [:params, :textDelta],
      ["params", "msg", "textDelta"],
      [:params, :msg, :textDelta],
      ["params", "outputDelta"],
      [:params, :outputDelta],
      ["params", "msg", "outputDelta"],
      [:params, :msg, :outputDelta],
      ["params", "text"],
      [:params, :text],
      ["params", "msg", "text"],
      [:params, :msg, :text],
      ["params", "summaryText"],
      [:params, :summaryText],
      ["params", "msg", "summaryText"],
      [:params, :msg, :summaryText],
      ["params", "msg", "content"],
      [:params, :msg, :content],
      ["params", "msg", "payload", "delta"],
      [:params, :msg, :payload, :delta],
      ["params", "msg", "payload", "textDelta"],
      [:params, :msg, :payload, :textDelta],
      ["params", "msg", "payload", "outputDelta"],
      [:params, :msg, :payload, :outputDelta],
      ["params", "msg", "payload", "text"],
      [:params, :msg, :payload, :text],
      ["params", "msg", "payload", "summaryText"],
      [:params, :msg, :payload, :summaryText],
      ["params", "msg", "payload", "content"],
      [:params, :msg, :payload, :content]
    ]
  end

  defp humanize_wrapper_event("mcp_startup_update", payload) do
    server =
      map_path(payload, ["params", "msg", "server"]) ||
        map_path(payload, [:params, :msg, :server]) || "mcp"

    state =
      map_path(payload, ["params", "msg", "status", "state"]) ||
        map_path(payload, [:params, :msg, :status, :state]) || T.t("updated")

    T.t("mcp startup: %{server} %{state}", server: server, state: state)
  end

  defp humanize_wrapper_event("mcp_startup_complete", _payload), do: T.t("mcp startup complete")
  defp humanize_wrapper_event("task_started", _payload), do: T.t("task started")
  defp humanize_wrapper_event("user_message", _payload), do: T.t("user message received")

  defp humanize_wrapper_event("item_started", payload) do
    case wrapper_payload_type(payload) do
      "token_count" -> humanize_wrapper_event("token_count", payload)
      type when is_binary(type) -> T.t("item started (%{type})", type: humanize_item_type(type))
      _ -> T.t("item started")
    end
  end

  defp humanize_wrapper_event("item_completed", payload) do
    case wrapper_payload_type(payload) do
      "token_count" -> humanize_wrapper_event("token_count", payload)
      type when is_binary(type) -> T.t("item completed (%{type})", type: humanize_item_type(type))
      _ -> T.t("item completed")
    end
  end

  defp humanize_wrapper_event("agent_message_delta", payload),
    do: humanize_streaming_event(T.t("agent message streaming"), payload)

  defp humanize_wrapper_event("agent_message_content_delta", payload),
    do: humanize_streaming_event(T.t("agent message content streaming"), payload)

  defp humanize_wrapper_event("agent_reasoning_delta", payload),
    do: humanize_streaming_event(T.t("reasoning streaming"), payload)

  defp humanize_wrapper_event("reasoning_content_delta", payload),
    do: humanize_streaming_event(T.t("reasoning content streaming"), payload)

  defp humanize_wrapper_event("agent_reasoning_section_break", _payload), do: T.t("reasoning section break")

  defp humanize_wrapper_event("agent_reasoning", payload) do
    value = extract_first_path(payload, reasoning_focus_paths())

    if is_binary(value) do
      trimmed = String.trim(value)
      if trimmed == "", do: T.t("reasoning update"), else: T.t("reasoning update: %{text}", text: inline_text(trimmed))
    else
      T.t("reasoning update")
    end
  end

  defp humanize_wrapper_event("turn_diff", _payload), do: T.t("turn diff updated")

  defp humanize_wrapper_event("exec_command_begin", payload) do
    command =
      map_path(payload, ["params", "msg", "command"]) ||
        map_path(payload, [:params, :msg, :command]) ||
        map_path(payload, ["params", "msg", "parsed_cmd"]) ||
        map_path(payload, [:params, :msg, :parsed_cmd])

    command = normalize_command(command)
    if is_binary(command), do: command, else: T.t("command started")
  end

  defp humanize_wrapper_event("exec_command_end", payload) do
    exit_code =
      map_path(payload, ["params", "msg", "exit_code"]) ||
        map_path(payload, [:params, :msg, :exit_code]) ||
        map_path(payload, ["params", "msg", "exitCode"]) ||
        map_path(payload, [:params, :msg, :exitCode])

    if is_integer(exit_code),
      do: T.t("command completed (exit %{code})", code: exit_code),
      else: T.t("command completed")
  end

  defp humanize_wrapper_event("exec_command_output_delta", _payload), do: T.t("command output streaming")
  defp humanize_wrapper_event("mcp_tool_call_begin", _payload), do: T.t("mcp tool call started")
  defp humanize_wrapper_event("mcp_tool_call_end", _payload), do: T.t("mcp tool call completed")

  defp humanize_wrapper_event("token_count", payload) do
    usage = extract_first_path(payload, token_usage_paths())

    case format_usage_counts(usage) do
      nil -> T.t("token count update")
      usage_text -> T.t("token count update (%{usage})", usage: usage_text)
    end
  end

  defp humanize_wrapper_event(other, payload) do
    msg_type =
      map_path(payload, ["params", "msg", "type"]) ||
        map_path(payload, [:params, :msg, :type])

    if is_binary(msg_type),
      do: T.t("%{event} (%{msg_type})", event: other, msg_type: msg_type),
      else: other
  end

  defp wrapper_payload_type(payload) do
    map_path(payload, ["params", "msg", "type"]) ||
      map_path(payload, [:params, :msg, :type]) ||
      map_path(payload, ["params", "msg", "payload", "type"]) ||
      map_path(payload, [:params, :msg, :payload, :type])
  end

  defp token_usage_paths do
    [
      ["params", "msg", "payload", "info", "total_token_usage"],
      [:params, :msg, :payload, :info, :total_token_usage],
      ["params", "msg", "info", "total_token_usage"],
      [:params, :msg, :info, :total_token_usage],
      ["params", "tokenUsage", "total"],
      [:params, :tokenUsage, :total]
    ]
  end

  defp reasoning_focus_paths do
    [
      ["params", "reason"],
      [:params, :reason],
      ["params", "summaryText"],
      [:params, :summaryText],
      ["params", "summary"],
      [:params, :summary],
      ["params", "text"],
      [:params, :text],
      ["params", "msg", "reason"],
      [:params, :msg, :reason],
      ["params", "msg", "summaryText"],
      [:params, :msg, :summaryText],
      ["params", "msg", "summary"],
      [:params, :msg, :summary],
      ["params", "msg", "text"],
      [:params, :msg, :text],
      ["params", "msg", "payload", "reason"],
      [:params, :msg, :payload, :reason],
      ["params", "msg", "payload", "summaryText"],
      [:params, :msg, :payload, :summaryText],
      ["params", "msg", "payload", "summary"],
      [:params, :msg, :payload, :summary],
      ["params", "msg", "payload", "text"],
      [:params, :msg, :payload, :text]
    ]
  end
end
