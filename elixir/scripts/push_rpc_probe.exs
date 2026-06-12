cookie = System.get_env("SYMPHONY_NODE_COOKIE") || "symphony-dev-cookie"
node_name = :"#{System.get_env("SYMPHONY_NODE_NAME") || "symphony"}@127.0.0.1"

{:ok, _} = Node.start(:"probe_#{:erlang.unique_integer([:positive])}@127.0.0.1", :longnames)
Node.set_cookie(String.to_atom(cookie))

case Node.connect(node_name) do
  true ->
    IO.puts("connected to #{node_name}")

    enabled = :rpc.call(node_name, SymphonyElixir.PushNotifications.Config, :enabled?, [])
    IO.puts("enabled?: #{inspect(enabled)}")

    subs = :rpc.call(node_name, SymphonyElixir.PushNotifications.Subscriptions, :list, [])
    IO.puts("subscriptions: #{length(subs)}")

    body =
      Jason.encode!(%{
        kind: "test",
        title: "Symphony RPC probe",
        body: "If you see this, push works",
        url: "/tracker/settings",
        tag: "rpc-probe"
      })

    Enum.each(subs, fn s ->
      ex = %ExNudge.Subscription{endpoint: s.endpoint, keys: %{p256dh: s.p256dh, auth: s.auth}}
      result = :rpc.call(node_name, ExNudge, :send_notification, [ex, body, [urgency: :high, ttl: 300]])
      IO.puts("endpoint=#{String.slice(s.endpoint, 0, 60)}...")
      IO.inspect(result, label: "send_notification result")
    end)

  false ->
    IO.puts("FAILED to connect to #{node_name} (cookie=#{cookie})")
end
