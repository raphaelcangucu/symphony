defmodule SymphonyElixirWeb.TrackerAuth do
  @moduledoc "Bearer-token authentication for the local tracker API."

  import Plug.Conn

  alias Phoenix.Controller
  alias Plug.Conn
  alias SymphonyElixir.Config

  @unauthorized_payload %{error: %{code: "unauthorized", message: "invalid tracker token"}}

  @spec init(keyword()) :: keyword()
  def init(opts), do: opts

  @spec call(Conn.t(), keyword()) :: Conn.t()
  def call(conn, _opts) do
    expected_token = System.get_env(Config.local_api_token_env())
    provided_token = bearer_token(conn)

    if valid_token?(provided_token, expected_token) do
      conn
    else
      conn
      |> Conn.put_status(:unauthorized)
      |> Controller.json(@unauthorized_payload)
      |> halt()
    end
  end

  @spec valid_token?(String.t() | nil, String.t() | nil) :: boolean()
  def valid_token?(provided_token, expected_token)
      when is_binary(provided_token) and is_binary(expected_token) do
    expected_token != "" and byte_size(provided_token) == byte_size(expected_token) and
      Plug.Crypto.secure_compare(provided_token, expected_token)
  end

  def valid_token?(_provided_token, _expected_token), do: false

  defp bearer_token(conn) do
    conn
    |> get_req_header("authorization")
    |> List.first()
    |> parse_bearer_token()
  end

  defp parse_bearer_token("Bearer " <> token), do: token
  defp parse_bearer_token(_header), do: nil
end
