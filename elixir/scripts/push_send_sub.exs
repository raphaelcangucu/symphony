[sub_path | _] = Enum.reject(System.argv(), &(&1 == "--"))
sub = sub_path |> File.read!() |> Jason.decode!()

cookie = System.get_env("SYMPHONY_NODE_COOKIE") || "symphony-dev-cookie"
node_name = :"#{System.get_env("SYMPHONY_NODE_NAME") || "symphony"}@127.0.0.1"

{:ok, _} = Node.start(:"sender_#{:erlang.unique_integer([:positive])}@127.0.0.1", :longnames)
Node.set_cookie(String.to_atom(cookie))

unless Node.connect(node_name) do
  IO.puts("FAILED to connect to #{node_name}")
  System.halt(1)
end

ex = %ExNudge.Subscription{
  endpoint: sub["endpoint"],
  keys: %{p256dh: sub["keys"]["p256dh"], auth: sub["keys"]["auth"]}
}

body =
  Jason.encode!(%{
    kind: "test",
    title: "Symphony E2E (real FCM)",
    body: "Sent by Elixir ex_nudge through FCM",
    url: "/tracker/settings",
    tag: "pw-e2e-fcm"
  })

result = :rpc.call(node_name, ExNudge, :send_notification, [ex, body, [urgency: :high, ttl: 300]])

case result do
  {:ok, %{status_code: status}} -> IO.puts("SEND_OK status=#{status}")
  other -> IO.inspect(other, label: "SEND_RESULT")
end
