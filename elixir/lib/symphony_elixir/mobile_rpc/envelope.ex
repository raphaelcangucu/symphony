defmodule SymphonyElixir.MobileRpc.Envelope do
  @moduledoc "Validation and encoding for version-one mobile RPC envelopes."

  @max_deadline_ms 120_000
  @id_pattern ~r/^[A-Za-z0-9_.:-]{1,128}$/
  @method_pattern ~r/^[a-z][A-Za-z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)+$/

  @spec decode(map()) :: {:ok, map()} | {:error, atom()}
  def decode(
        %{
          "type" => "rpc",
          "id" => id,
          "method" => method,
          "params" => params
        } = envelope
      )
      when is_binary(id) and is_binary(method) and is_map(params) do
    with :ok <- validate_id(id),
         :ok <- validate_method(method),
         {:ok, deadline_ms} <- validate_deadline(Map.get(envelope, "deadline_ms")) do
      {:ok,
       %{
         type: :rpc,
         id: id,
         method: method,
         params: params,
         deadline_ms: deadline_ms
       }}
    end
  end

  def decode(%{"type" => "cancel", "id" => id}) when is_binary(id) do
    with :ok <- validate_id(id), do: {:ok, %{type: :cancel, id: id}}
  end

  def decode(%{"type" => "unsubscribe", "subscription_id" => id}) when is_binary(id) do
    with :ok <- validate_id(id), do: {:ok, %{type: :unsubscribe, subscription_id: id}}
  end

  def decode(
        %{
          "type" => "event",
          "subscription_id" => id,
          "sequence" => sequence,
          "event" => event
        } = envelope
      )
      when is_binary(id) and is_integer(sequence) and is_binary(event) do
    cond do
      validate_id(id) != :ok -> {:error, :invalid_subscription_id}
      sequence < 1 -> {:error, :invalid_sequence}
      not Regex.match?(@method_pattern, event) -> {:error, :invalid_event}
      not Map.has_key?(envelope, "payload") -> {:error, :invalid_event}
      true -> {:ok, %{type: :event, subscription_id: id, sequence: sequence, event: event}}
    end
  end

  def decode(_envelope), do: {:error, :invalid_envelope}

  @spec result(String.t(), term(), map()) :: String.t()
  def result(id, result, context) do
    Jason.encode!(%{
      "type" => "result",
      "id" => id,
      "ok" => true,
      "result" => result,
      "meta" => metadata(context)
    })
  end

  @spec error(String.t(), String.t(), String.t(), boolean(), map()) :: String.t()
  def error(id, code, message, retryable, context) do
    error(id, code, message, retryable, nil, context)
  end

  @spec error(String.t(), String.t(), String.t(), boolean(), term(), map()) :: String.t()
  def error(id, code, message, retryable, data, context) do
    error =
      %{
        "code" => code,
        "message" => message,
        "retryable" => retryable
      }
      |> maybe_put_data(data)

    Jason.encode!(%{
      "type" => "result",
      "id" => id,
      "ok" => false,
      "error" => error,
      "meta" => metadata(context)
    })
  end

  @spec event(String.t(), pos_integer(), String.t(), term()) :: String.t()
  def event(subscription_id, sequence, event, payload) do
    Jason.encode!(%{
      "type" => "event",
      "subscription_id" => subscription_id,
      "sequence" => sequence,
      "event" => event,
      "payload" => payload
    })
  end

  defp metadata(context) do
    %{
      "host_id" => Map.fetch!(context, :host_id),
      "protocol" => Map.fetch!(context, :protocol),
      "server_timestamp" => DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp maybe_put_data(error, nil), do: error
  defp maybe_put_data(error, data), do: Map.put(error, "data", data)

  defp validate_id(id) do
    if Regex.match?(@id_pattern, id), do: :ok, else: {:error, :invalid_id}
  end

  defp validate_method(method) do
    if Regex.match?(@method_pattern, method), do: :ok, else: {:error, :invalid_method}
  end

  defp validate_deadline(nil), do: {:ok, nil}

  defp validate_deadline(deadline)
       when is_integer(deadline) and deadline > 0 and deadline <= @max_deadline_ms,
       do: {:ok, deadline}

  defp validate_deadline(_deadline), do: {:error, :invalid_deadline}
end
