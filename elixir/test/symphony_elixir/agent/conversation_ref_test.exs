defmodule SymphonyElixir.Agent.ConversationRefTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.ConversationRef

  test "constructs and serializes a provider conversation identity" do
    assert {:ok, ref} = ConversationRef.new(" claude ", " session-1 ")
    assert ref.provider == "claude"
    assert ref.conversation_id == "session-1"

    assert ConversationRef.dump(ref) == %{
             "provider" => "claude",
             "conversation_id" => "session-1"
           }

    assert {:ok, ^ref} = ConversationRef.load(ConversationRef.dump(ref))
  end

  test "rejects blank or unsupported identities" do
    assert {:error, :provider_required} = ConversationRef.new(" ", "session-1")
    assert {:error, :conversation_id_required} = ConversationRef.new("codex", " ")
    assert {:error, {:unsupported_provider, "other"}} = ConversationRef.new("other", "session-1")
    assert {:error, :invalid_conversation_ref} = ConversationRef.load(%{"provider" => "codex"})

    assert {:error, :invalid_conversation_ref} =
             ConversationRef.load(%{"provider" => "codex", "external_id" => "legacy"})

    assert {:error, :invalid_conversation_ref} =
             ConversationRef.load(%{
               "provider" => "codex",
               "conversation_id" => "canonical",
               "external_id" => "legacy"
             })
  end

  test "revalidates manually constructed structs at the boundary" do
    invalid = %ConversationRef{provider: "legacy", conversation_id: "native-id"}
    assert {:error, :invalid_conversation_ref} = ConversationRef.load(invalid)
  end
end
