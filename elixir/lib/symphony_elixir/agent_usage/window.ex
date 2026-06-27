defmodule SymphonyElixir.AgentUsage.Window do
  @moduledoc """
  A single normalized plan-usage window plus the `normalize/3` that turns a raw
  agent rate-limit payload into a `SymphonyElixir.AgentUsage.Snapshot`.

  The raw shape mirrors the Codex `token_count` rate_limits payload already
  flowing through Symphony (see `codex/event_humanizer.ex` and
  `status_dashboard.ex`): a top-level map with `limit_name`/`limit_id`,
  `primary`/`secondary` buckets, and `credits`. Each bucket carries
  `usedPercent`, `windowDurationMins`, and a reset field (absolute `reset_at`
  variants or relative `reset_in_seconds`). The normalizer is the single place
  that absorbs schema differences across agents, so callers always get the same
  normalized struct.
  """

  alias SymphonyElixir.AgentUsage.Snapshot

  @enforce_keys [:kind, :used_percent]
  defstruct [:kind, :used_percent, :resets_at, :window_minutes]

  @type kind :: :session | :weekly | :reviews | {:model, String.t()}

  @type t :: %__MODULE__{
          kind: kind(),
          used_percent: float(),
          resets_at: integer() | nil,
          window_minutes: integer() | nil
        }

  @used_percent_keys ["usedPercent", :usedPercent, "used_percent", :used_percent]
  @window_mins_keys [
    "windowDurationMins",
    :windowDurationMins,
    "window_duration_mins",
    :window_duration_mins
  ]
  @reset_at_keys [
    "reset_at",
    :reset_at,
    "resetAt",
    :resetAt,
    "resets_at",
    :resets_at,
    "resetsAt",
    :resetsAt
  ]
  @reset_in_keys ["reset_in_seconds", :reset_in_seconds, "resetInSeconds", :resetInSeconds]
  @plan_keys ["limit_name", :limit_name, "limit_id", :limit_id]

  @spec normalize(String.t(), map() | nil) :: Snapshot.t()
  @spec normalize(String.t(), map() | nil, integer()) :: Snapshot.t()
  def normalize(agent_kind, payload, now \\ System.system_time(:second))

  def normalize(agent_kind, payload, now) when is_binary(agent_kind) and is_map(payload) do
    %Snapshot{
      agent_kind: agent_kind,
      plan: pick_string(payload, @plan_keys),
      windows: build_windows(payload, now),
      model_limits: [],
      credits_remaining: credits_remaining(payload),
      credits_unlimited: credits_unlimited?(payload)
    }
  end

  def normalize(agent_kind, _payload, _now) when is_binary(agent_kind) do
    %Snapshot{agent_kind: agent_kind, windows: [], model_limits: []}
  end

  defp build_windows(payload, now) do
    [{:session, pick(payload, ["primary", :primary])}, {:weekly, pick(payload, ["secondary", :secondary])}]
    |> Enum.map(fn {kind, bucket} -> build_window(kind, bucket, now) end)
    |> Enum.reject(&is_nil/1)
  end

  defp build_window(kind, bucket, now) when is_map(bucket) do
    case clamped_percent(pick(bucket, @used_percent_keys)) do
      nil ->
        nil

      used_percent ->
        %__MODULE__{
          kind: kind,
          used_percent: used_percent,
          resets_at: resolve_resets_at(bucket, now),
          window_minutes: to_integer(pick(bucket, @window_mins_keys))
        }
    end
  end

  defp build_window(_kind, _bucket, _now), do: nil

  defp clamped_percent(value) when is_number(value) do
    value |> max(0) |> min(100) |> :erlang.float()
  end

  defp clamped_percent(_value), do: nil

  defp resolve_resets_at(bucket, now) do
    case to_integer(pick(bucket, @reset_at_keys)) do
      nil -> relative_reset(bucket, now)
      absolute -> absolute
    end
  end

  defp relative_reset(bucket, now) do
    case to_integer(pick(bucket, @reset_in_keys)) do
      nil -> nil
      seconds -> now + seconds
    end
  end

  defp credits_remaining(payload) do
    credits = pick(payload, ["credits", :credits])

    cond do
      not is_map(credits) -> nil
      pick(credits, ["unlimited", :unlimited]) == true -> nil
      true -> as_number(pick(credits, ["balance", :balance]))
    end
  end

  defp credits_unlimited?(payload) do
    credits = pick(payload, ["credits", :credits])
    is_map(credits) and pick(credits, ["unlimited", :unlimited]) == true
  end

  defp pick(map, keys) when is_map(map), do: Enum.find_value(keys, &Map.get(map, &1))
  defp pick(_map, _keys), do: nil

  defp pick_string(map, keys) do
    case pick(map, keys) do
      value when is_binary(value) -> value
      _ -> nil
    end
  end

  defp as_number(value) when is_number(value), do: value
  defp as_number(_value), do: nil

  defp to_integer(value) when is_integer(value), do: value
  defp to_integer(value) when is_float(value), do: trunc(value)
  defp to_integer(_value), do: nil
end
