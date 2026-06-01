defmodule SymphonyElixir.Tracker.Sync.MergeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Tracker.Sync.Merge

  defp iso(seconds_from_now), do: DateTime.utc_now() |> DateTime.add(seconds_from_now, :second) |> DateTime.to_iso8601()

  test "untouched fields take the remote value" do
    result =
      Merge.merge_fields(
        %{title: "local", description: "local body"},
        %{},
        %{title: "remote", description: "remote body"},
        DateTime.utc_now(),
        [:title, :description]
      )

    assert result.attrs == %{title: "remote", description: "remote body"}
    assert result.dirty_fields == %{}
    refute result.conflict?
  end

  test "a local edit newer than the remote keeps the local value" do
    remote_updated = DateTime.utc_now()
    dirty = %{"title" => iso(60)}

    result =
      Merge.merge_fields(%{title: "local-new"}, dirty, %{title: "remote-old"}, remote_updated, [:title])

    refute Map.has_key?(result.attrs, :title)
    assert result.dirty_fields == dirty
    refute result.conflict?
  end

  test "a remote change newer than the local edit wins and flags conflict" do
    remote_updated = DateTime.utc_now()
    dirty = %{"title" => iso(-60)}

    result =
      Merge.merge_fields(%{title: "local-old"}, dirty, %{title: "remote-new"}, remote_updated, [:title])

    assert result.attrs == %{title: "remote-new"}
    assert result.dirty_fields == %{}
    assert result.conflict?
  end

  test "ignores remote keys not in the syncable list" do
    result =
      Merge.merge_fields(%{title: "local"}, %{}, %{title: "remote", url: "x"}, DateTime.utc_now(), [:title])

    assert result.attrs == %{title: "remote"}
  end
end
