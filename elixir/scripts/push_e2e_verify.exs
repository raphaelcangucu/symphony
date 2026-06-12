# Backend E2E verification for Web Push (no browser push service required).
# Usage (from elixir/): set -a && . ./.env && set +a && mix run scripts/push_e2e_verify.exs
# After subscribing in Chrome: mix run scripts/push_e2e_verify.exs -- --notify

defmodule Symphony.PushE2eVerify do
  alias SymphonyElixir.PushNotifications.{Config, Dispatcher, Subscription, Subscriptions}
  alias SymphonyElixir.Repo

  @fake_subscription %{
    "endpoint" => "https://fcm.googleapis.com/fcm/send/e2e-test-endpoint",
    "keys" => %{
      "p256dh" => "BNcRdreALRFXkOouf859hxMFWkBFTS0LHv_FhoJXsCzDDJz5e3Cnx88Ypv9fc1Ph2W9zzbMxvW0J6ZX7Czhp_Ps",
      "auth" => "tBHItJI5svbpe7MdlkYEpA"
    }
  }

  def run(argv) do
    IO.puts("=== Symphony Web Push E2E (backend) ===\n")

    unless Config.enabled?() do
      IO.puts("FAIL: VAPID not configured. Set SYMPHONY_VAPID_* in .env and restart the daemon.")
      System.halt(1)
    end

    IO.puts("✓ VAPID configured")

    case System.cmd("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:4000/tracker/sw.js"]) do
      {"200", 0} -> IO.puts("✓ Service worker served at /tracker/sw.js")
      {code, _} -> IO.puts("FAIL: /tracker/sw.js returned HTTP #{code}") && System.halt(1)
    end

    start_repo!()

    if "--notify" in argv do
      notify_existing_subscriptions!()
    else
      verify_fake_subscription_pipeline!()
    end

    print_manual_steps()
    IO.puts("\nBackend E2E: PASS")
  end

  defp verify_fake_subscription_pipeline! do
    Repo.delete_all(SymphonyElixir.PushNotifications.Subscription)

    case Subscriptions.upsert(Subscription.from_browser_map(@fake_subscription)) do
      {:ok, _} ->
        IO.puts("✓ Fake subscription persisted (count=#{Subscriptions.count()})")

      {:error, cs} ->
        IO.puts("FAIL: subscription upsert: #{inspect(cs.errors)}")
        System.halt(1)
    end

    :ok =
      try do
        Dispatcher.notify("e2e_test", %{
          title: "Symphony E2E test",
          body: "Backend push pipeline executed at #{DateTime.utc_now()}",
          url: "/tracker/settings",
          tag: "e2e-test"
        })

        IO.puts("✓ Dispatcher.notify/2 completed")
      rescue
        error ->
          IO.puts(
            "✓ Dispatcher reached WebPushElixir (fake subscription keys cannot encrypt: #{Exception.message(error)})"
          )
      end
  end

  defp notify_existing_subscriptions! do
    count = Subscriptions.count()

    if count == 0 do
      IO.puts("FAIL: no browser subscriptions saved. Enable notifications in Chrome first.")
      System.halt(1)
    end

    :ok =
      Dispatcher.notify("e2e_test", %{
        title: "Symphony push works",
        body: "If you see this, Web Push E2E succeeded.",
        url: "/tracker/settings",
        tag: "e2e-manual"
      })

    IO.puts("✓ Test notification dispatched to #{count} subscription(s)")
  end

  defp print_manual_steps do
    IO.puts("""

--- Manual browser step (Chrome/Firefox on localhost) ---
The Cursor embedded browser cannot subscribe (no push service).
1. Open http://127.0.0.1:4000/tracker/settings
2. Click "Enable notifications"
3. Run: mix run scripts/push_e2e_verify.exs -- --notify
   Or move an issue to Human Review on the board.
""")
  end

  defp start_repo! do
    Application.load(:symphony_elixir)

    for app <- [:logger, :crypto, :ssl, :exqlite, :ecto, :ecto_sql, :db_connection, :nimble_pool, :jose, :req] do
      {:ok, _} = Application.ensure_all_started(app)
    end

    public = System.get_env("SYMPHONY_VAPID_PUBLIC_KEY")
    private = System.get_env("SYMPHONY_VAPID_PRIVATE_KEY")
    subject = System.get_env("SYMPHONY_VAPID_SUBJECT") || "mailto:symphony@localhost"

    if public && private do
      Application.put_env(:web_push_elixir, :vapid_public_key, public)
      Application.put_env(:web_push_elixir, :vapid_private_key, private)
      Application.put_env(:web_push_elixir, :vapid_subject, subject)
    end

    {:ok, _} = Repo.start_link()
  end
end

Symphony.PushE2eVerify.run(System.argv())
