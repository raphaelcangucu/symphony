defmodule SymphonyElixir.AttachedContexts.AttachmentTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AttachedContexts.Attachment
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts.Entry

  setup do
    migrate_repo()
    Repo.delete_all(Attachment)
    Repo.delete_all(Entry)
    :ok
  end

  describe "Attachment.changeset/2" do
    test "accepts a valid execution attachment" do
      changeset = Attachment.changeset(%Attachment{}, valid_execution_attachment_attrs())

      assert changeset.valid?
      assert Ecto.Changeset.get_field(changeset, :metadata) == %{}
      assert Ecto.Changeset.get_field(changeset, :position) == 0
    end

    test "rejects invalid scopes" do
      changeset =
        Attachment.changeset(%Attachment{}, %{
          valid_execution_attachment_attrs()
          | scope: "project"
        })

      refute changeset.valid?
      assert %{scope: ["is invalid"]} = errors_on(changeset)
    end

    test "requires issue_identifier for execution scope" do
      changeset =
        Attachment.changeset(%Attachment{}, %{
          valid_execution_attachment_attrs()
          | issue_identifier: nil
        })

      refute changeset.valid?
      assert %{issue_identifier: ["can't be blank"]} = errors_on(changeset)
    end

    test "requires thread_id for assistant scope" do
      changeset =
        Attachment.changeset(%Attachment{}, %{
          valid_execution_attachment_attrs()
          | scope: "assistant",
            issue_identifier: nil,
            thread_id: nil
        })

      refute changeset.valid?
      assert %{thread_id: ["can't be blank"]} = errors_on(changeset)
    end

    test "rejects invalid kinds" do
      changeset =
        Attachment.changeset(%Attachment{}, %{
          valid_execution_attachment_attrs()
          | kind: "document"
        })

      refute changeset.valid?
      assert %{kind: ["is invalid"]} = errors_on(changeset)
    end

    test "enforces one attachment per execution scope and context reference" do
      attrs = valid_execution_attachment_attrs()

      assert {:ok, _attachment} = %Attachment{} |> Attachment.changeset(attrs) |> Repo.insert()

      assert {:error, changeset} =
               %Attachment{} |> Attachment.changeset(attrs) |> Repo.insert()

      assert %{ref_key: [_message]} = errors_on(changeset)
    end

    test "enforces one attachment per assistant thread and context reference" do
      attrs = valid_assistant_attachment_attrs()

      assert {:ok, _attachment} = %Attachment{} |> Attachment.changeset(attrs) |> Repo.insert()

      assert {:error, changeset} =
               %Attachment{} |> Attachment.changeset(attrs) |> Repo.insert()

      assert %{ref_key: [_message]} = errors_on(changeset)
    end
  end

  describe "Entry.changeset/2" do
    test "accepts a valid saved context entry" do
      changeset =
        Entry.changeset(%Entry{}, %{
          project_slug: "demo",
          slug: "weekly-recap",
          name: "Weekly recap",
          content_md: "## Recap",
          source_scope: "execution",
          source_issue_identifier: "SYM-1"
        })

      assert changeset.valid?
      assert Ecto.Changeset.get_field(changeset, :metadata) == %{}
    end

    test "rejects invalid source scopes" do
      changeset =
        Entry.changeset(%Entry{}, %{
          project_slug: "demo",
          slug: "weekly-recap",
          content_md: "## Recap",
          source_scope: "project"
        })

      refute changeset.valid?
      assert %{source_scope: ["is invalid"]} = errors_on(changeset)
    end
  end

  defp valid_execution_attachment_attrs do
    %{
      scope: "execution",
      project_slug: "demo",
      issue_identifier: "SYM-1",
      thread_id: nil,
      kind: "board_issue",
      ref_key: "SYM-2",
      title: "Board issue SYM-2",
      content_md: "## Board issue SYM-2"
    }
  end

  defp valid_assistant_attachment_attrs do
    %{
      valid_execution_attachment_attrs()
      | scope: "assistant",
        issue_identifier: nil,
        thread_id: 42
    }
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
