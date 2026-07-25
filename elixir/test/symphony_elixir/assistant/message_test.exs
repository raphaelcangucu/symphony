defmodule SymphonyElixir.Assistant.MessageTest do
  use ExUnit.Case, async: true

  alias Ecto.Changeset
  alias SymphonyElixir.Assistant.Message

  @whitespace " \n "

  test "preserves whitespace only for assistant content while normalizing other fields" do
    assistant_changeset =
      Message.changeset(%Message{}, %{
        thread_id: 1,
        sequence: 1,
        role: "assistant",
        content: @whitespace,
        run_id: @whitespace
      })

    assert assistant_changeset.valid?
    assert Changeset.get_change(assistant_changeset, :content) == @whitespace
    assert Changeset.get_field(assistant_changeset, :content) == @whitespace
    refute Map.has_key?(assistant_changeset.changes, :turn_id)
    assert Changeset.get_field(assistant_changeset, :turn_id) == nil

    for role <- ~w(user tool system) do
      changeset =
        Message.changeset(%Message{}, %{
          thread_id: 1,
          sequence: 1,
          role: role,
          content: @whitespace
        })

      refute changeset.valid?
      assert {"can't be blank", _metadata} = changeset.errors[:content]
    end
  end
end
