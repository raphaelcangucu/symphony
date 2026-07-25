defmodule SymphonyElixir.MobileRpc.PairingOfferTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.MobileRpc.{Device, HostIdentity, PairingOffer}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(Device)
    Repo.delete_all(HostIdentity)
    :ok
  end

  test "creates an Orca-style QR/deep-link offer for one pending mobile device" do
    assert {:ok, %{url: url, offer: offer}} =
             PairingOffer.generate(
               "wss://mac-studio.example.test/symphony/mobile/rpc",
               "Mac Studio",
               "Raphael iPhone"
             )

    assert String.starts_with?(url, "symphony://pair?code=")
    assert offer["v"] == 1
    assert offer["endpoint"] == "wss://mac-studio.example.test/symphony/mobile/rpc"
    assert offer["host_name"] == "Mac Studio"
    assert offer["scope"] == "mobile"
    assert offer["protocol_min"] == 1
    assert offer["protocol_max"] == 1
    assert is_binary(offer["device_token"])
    assert byte_size(Base.url_decode64!(offer["host_public_key"], padding: false)) == 32

    assert {:ok, decoded} = PairingOffer.decode(url)
    assert decoded == offer
  end

  test "rejects endpoints that cannot be used as credential-free WebSockets" do
    assert {:error, :unsupported_endpoint_scheme} =
             PairingOffer.generate("https://host.test/mobile/rpc", "Host", "Phone")

    assert {:error, :endpoint_contains_credentials} =
             PairingOffer.generate("wss://user:pass@host.test/mobile/rpc", "Host", "Phone")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
