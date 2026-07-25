defmodule SymphonyElixir.MobileRpc.OrcaMethod do
  @moduledoc false

  @spec validate_params(map(), [String.t()], [String.t()], [String.t()]) ::
          {:ok, map()} | {:error, :invalid_params}
  def validate_params(params, allowed_keys, required_keys, nullable_required_keys \\ [])

  def validate_params(params, allowed_keys, required_keys, nullable_required_keys)
      when is_map(params) and is_list(allowed_keys) and is_list(required_keys) and
             is_list(nullable_required_keys) do
    if Enum.all?(Map.keys(params), &(&1 in allowed_keys)) and
         Enum.all?(
           required_keys,
           &(present?(params, &1) or
               (&1 in nullable_required_keys and Map.has_key?(params, &1)))
         ) do
      {:ok, params}
    else
      {:error, :invalid_params}
    end
  end

  def validate_params(_params, _allowed_keys, _required_keys, _nullable_required_keys),
    do: {:error, :invalid_params}

  defmacro __using__(opts) do
    name = Keyword.fetch!(opts, :name)
    allowed_keys = Keyword.get(opts, :allowed_keys, [])
    required_keys = Keyword.get(opts, :required_keys, [])
    nullable_required_keys = Keyword.get(opts, :nullable_required_keys, [])
    timeout_ms = Keyword.get(opts, :timeout_ms, 5_000)
    service = Keyword.get(opts, :service, SymphonyElixir.MobileRpc.OrcaPresenter)
    service_key = Keyword.get(opts, :service_key)
    subscription = Keyword.get(opts, :subscription, false)

    quote bind_quoted: [
            name: name,
            allowed_keys: allowed_keys,
            required_keys: required_keys,
            nullable_required_keys: nullable_required_keys,
            timeout_ms: timeout_ms,
            service: service,
            service_key: service_key,
            subscription: subscription
          ] do
      @behaviour SymphonyElixir.MobileRpc.Method
      @name name
      @allowed_keys allowed_keys
      @required_keys required_keys
      @nullable_required_keys nullable_required_keys
      @timeout_ms timeout_ms
      @service service
      @service_key service_key
      @subscription subscription

      @impl true
      def name, do: @name

      @impl true
      def scope, do: :mobile

      @impl true
      def timeout_ms, do: @timeout_ms

      @impl true
      def validate(params) do
        SymphonyElixir.MobileRpc.OrcaMethod.validate_params(
          params,
          @allowed_keys,
          @required_keys,
          @nullable_required_keys
        )
      end

      @impl true
      def call(params, context) do
        service = if @service_key, do: Map.get(context, @service_key, @service), else: @service

        if @subscription do
          service.subscribe(@name, params, context)
        else
          service.call(@name, params, context)
        end
      end
    end
  end

  defp present?(params, key) do
    case Map.fetch(params, key) do
      {:ok, value} when is_binary(value) -> String.trim(value) != ""
      {:ok, nil} -> false
      {:ok, _value} -> true
      :error -> false
    end
  end
end
