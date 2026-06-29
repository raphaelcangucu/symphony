defmodule SymphonyElixir.TelegramGateway.Client do
  @moduledoc "Thin Req-backed Telegram Bot API client."

  alias SymphonyElixir.Settings.Credentials

  @api_root "https://api.telegram.org"

  @spec call(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def call(method, payload, opts \\ []) when is_binary(method) and is_map(payload) and is_list(opts) do
    token = Keyword.get(opts, :token) || Credentials.get("telegram", "bot_token")
    req = Keyword.get(opts, :req, Req)

    with {:ok, token} <- require_token(token),
         {:ok, response} <- post(req, token, method, payload) do
      normalize_response(response)
    end
  end

  defp require_token(token) when is_binary(token) do
    case String.trim(token) do
      "" -> {:error, :telegram_bot_token_missing}
      trimmed -> {:ok, trimmed}
    end
  end

  defp require_token(_token), do: {:error, :telegram_bot_token_missing}

  defp post(req, token, method, payload) do
    req.post(url(token, method), json: payload)
  rescue
    error -> {:error, error}
  end

  defp normalize_response(%{status: status, body: %{"ok" => true} = body}) when status in 200..299, do: {:ok, body}
  defp normalize_response(%{status: status, body: body}), do: {:error, {:telegram_api_error, status, body}}
  defp normalize_response(other), do: {:error, {:unexpected_telegram_response, other}}

  defp url(token, method), do: @api_root <> "/bot" <> token <> "/" <> method
end
