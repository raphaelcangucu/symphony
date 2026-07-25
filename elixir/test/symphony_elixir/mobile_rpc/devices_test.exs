defmodule SymphonyElixir.MobileRpc.DevicesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.MobileRpc.{Device, Devices, HostIdentity}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Vault

  setup do
    migrate_repo()
    Repo.delete_all(Device)
    Repo.delete_all(HostIdentity)
    :ok
  end

  test "persists one encrypted static X25519 host identity" do
    assert {:ok, first} = HostIdentity.get_or_create("Mac Studio")
    assert {:ok, second} = HostIdentity.get_or_create("Renamed later")

    assert first.id == second.id
    assert first.host_id == second.host_id
    assert first.public_key == second.public_key
    assert byte_size(first.public_key) == 32
    assert Repo.aggregate(HostIdentity, :count) == 1
    refute first.private_key_ciphertext == Base.encode64(first.public_key)

    assert {:ok, private_key} = HostIdentity.private_key(first)
    assert byte_size(private_key) == 32
    assert Vault.decrypt(first.private_key_ciphertext) == {:ok, Base.encode64(private_key)}
  end

  test "stores only keyed token digests and rotates an unused pending offer" do
    assert {:ok, %{device: first, token: first_token}} = Devices.create_pairing("Raphael iPhone")
    assert {:ok, %{device: second, token: second_token}} = Devices.create_pairing("Raphael iPad")

    refute first_token == second_token
    refute first.token_digest == :crypto.hash(:sha256, first_token)
    refute second.token_digest == :crypto.hash(:sha256, second_token)

    refute Repo.get!(Device, first.id).token_digest == first_token
    assert Repo.get!(Device, first.id).revoked_at
    assert Repo.get!(Device, second.id).revoked_at == nil
    assert second.paired_at == nil

    assert {:error, :revoked} = Devices.validate_token(first.device_id, first_token)
    assert {:ok, validated} = Devices.validate_token(second.device_id, second_token)
    assert validated.id == second.id
    assert {:error, :invalid_token} = Devices.validate_token(second.device_id, "wrong-token")
  end

  test "activates on first encrypted authentication and revokes devices individually" do
    assert {:ok, %{device: phone, token: phone_token}} = Devices.create_pairing("Raphael iPhone")
    assert {:ok, phone} = Devices.activate(phone.device_id, phone_token, 1)
    assert phone.paired_at
    assert phone.last_seen_at
    assert phone.protocol_version == 1

    assert {:ok, %{device: tablet, token: tablet_token}} = Devices.create_pairing("Raphael iPad")
    assert {:ok, tablet} = Devices.activate(tablet.device_id, tablet_token, 1)

    assert :ok = Devices.revoke(phone.device_id)
    assert {:error, :revoked} = Devices.validate_token(phone.device_id, phone_token)
    assert {:ok, current_tablet} = Devices.validate_token(tablet.device_id, tablet_token)
    assert current_tablet.revoked_at == nil

    assert Enum.map(Devices.list_paired(), & &1.device_id) == [tablet.device_id]
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
