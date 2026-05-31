defmodule SymphonyElixir.Assistant.Message do
  @moduledoc "Persistent project assistant chat message."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Thread

  @roles ~w(user assistant tool system)

  @type t :: %__MODULE__{}

  schema "assistant_messages" do
    field(:sequence, :integer)
    field(:role, :string)
    field(:content, :string)
    field(:turn_id, :string)
    field(:tool_calls, :map, default: %{"calls" => []})
    field(:metadata, :map, default: %{})

    belongs_to(:thread, Thread)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(message, attrs) when is_map(attrs) do
    message
    |> cast(attrs, [:thread_id, :sequence, :role, :content, :turn_id, :tool_calls, :metadata])
    |> validate_required([:thread_id, :sequence, :role, :content])
    |> validate_number(:sequence, greater_than: 0)
    |> validate_inclusion(:role, @roles)
    |> validate_content()
    |> foreign_key_constraint(:thread_id)
    |> unique_constraint(:sequence, name: :assistant_messages_thread_id_sequence_index)
  end

  defp validate_content(changeset) do
    case get_field(changeset, :content) do
      content when is_binary(content) ->
        if String.trim(content) == "", do: add_error(changeset, :content, "can't be blank"), else: changeset

      _ ->
        changeset
    end
  end
end
