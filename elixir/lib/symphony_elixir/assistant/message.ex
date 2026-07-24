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
    field(:run_id, :string)
    field(:tool_calls, :map, default: %{"calls" => []})
    field(:metadata, :map, default: %{})

    belongs_to(:thread, Thread)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(message, attrs) when is_map(attrs) do
    raw_content = fetch_content(attrs)

    message
    |> cast(attrs, [:thread_id, :sequence, :role, :content, :run_id, :tool_calls, :metadata])
    |> restore_assistant_whitespace(raw_content)
    |> validate_required([:thread_id, :sequence, :role, :content])
    |> validate_number(:sequence, greater_than: 0)
    |> validate_inclusion(:role, @roles)
    |> validate_content()
    |> foreign_key_constraint(:thread_id)
    |> unique_constraint(:sequence, name: :assistant_messages_thread_id_sequence_index)
  end

  defp fetch_content(attrs) do
    cond do
      Map.has_key?(attrs, :content) -> {:ok, Map.get(attrs, :content)}
      Map.has_key?(attrs, "content") -> {:ok, Map.get(attrs, "content")}
      true -> :missing
    end
  end

  defp restore_assistant_whitespace(changeset, {:ok, content})
       when is_binary(content) and content != "" do
    if get_field(changeset, :role) == "assistant" and String.trim(content) == "",
      do: put_change(changeset, :content, content),
      else: changeset
  end

  defp restore_assistant_whitespace(changeset, _content), do: changeset

  defp validate_content(changeset) do
    case {get_field(changeset, :role), get_field(changeset, :content)} do
      {"assistant", content} when is_binary(content) and content != "" ->
        changeset

      {_role, content} when is_binary(content) ->
        if String.trim(content) == "", do: add_error(changeset, :content, "can't be blank"), else: changeset

      _ ->
        changeset
    end
  end
end
