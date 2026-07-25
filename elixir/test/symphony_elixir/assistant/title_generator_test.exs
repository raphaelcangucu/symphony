defmodule SymphonyElixir.Assistant.TitleGeneratorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.TitleGenerator

  test "normalize_title strips quotes, Title: prefix, fences, and caps length" do
    assert TitleGenerator.normalize_title("  \"Cleanup goapi GAM-19\"  ") == "Cleanup goapi GAM-19"
    assert TitleGenerator.normalize_title("Title: Fix sidebar sessions") == "Fix sidebar sessions"
    assert TitleGenerator.normalize_title("```\nGraphql POC wrap up\n```") == "Graphql POC wrap up"

    long = String.duplicate("a", 200)
    normalized = TitleGenerator.normalize_title(long)
    assert String.length(normalized) == 160
  end

  test "normalize_title returns empty for blank input" do
    assert TitleGenerator.normalize_title("   ") == ""
    assert TitleGenerator.normalize_title(nil) == ""
  end

  test "generic_title? matches defaults and blanks" do
    assert TitleGenerator.generic_title?(nil)
    assert TitleGenerator.generic_title?("")
    assert TitleGenerator.generic_title?("Project session")
    assert TitleGenerator.generic_title?("Issue session")
    assert TitleGenerator.generic_title?("Workspace session")
    assert TitleGenerator.generic_title?("Telegram freeform chat")
    refute TitleGenerator.generic_title?("Graphql POC Wrap UP")
  end

  test "enough_context? requires at least one user and one assistant message" do
    refute TitleGenerator.enough_context?([])
    refute TitleGenerator.enough_context?([%{role: "user", content: "hi"}])

    assert TitleGenerator.enough_context?([
             %{role: "user", content: "hi"},
             %{role: "assistant", content: "hello"}
           ])
  end

  test "build_prompt asks for a short session title only" do
    prompt =
      TitleGenerator.build_prompt([
        %{role: "user", content: "cleanup goapi for GAM-19"},
        %{role: "assistant", content: "I'll draft the plan."}
      ])

    assert prompt =~ "short session title"
    assert prompt =~ "cleanup goapi for GAM-19"
    assert prompt =~ "I'll draft the plan."
    assert prompt =~ "Return only the title"
  end

  test "generate returns normalized title from runner" do
    test_pid = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(test_pid, {:runner_opts, opts})
      {:ok, %{assistant_message: "Title: Cleanup goapi GAM-19\n"}}
    end

    assert {:ok, "Cleanup goapi GAM-19"} =
             TitleGenerator.generate(
               [
                 %{role: "user", content: "cleanup"},
                 %{role: "assistant", content: "ok"}
               ],
               runner: runner,
               workspace: "/tmp"
             )

    assert_receive {:runner_opts, opts}
    assert Keyword.fetch!(opts, :archive_on_stop)
  end

  test "generate errors when context is insufficient" do
    assert {:error, :not_enough_context} =
             TitleGenerator.generate([%{role: "user", content: "hi"}], workspace: "/tmp")
  end

  test "generate errors when runner returns blank title" do
    runner = fn _, _, _, _ -> {:ok, %{assistant_message: "   "}} end

    assert {:error, :no_answer} =
             TitleGenerator.generate(
               [
                 %{role: "user", content: "hi"},
                 %{role: "assistant", content: "yo"}
               ],
               runner: runner,
               workspace: "/tmp"
             )
  end

  test "propagate runner errors" do
    runner = fn _, _, _, _ -> {:error, :agent_failed} end

    assert {:error, :agent_failed} =
             TitleGenerator.generate(
               [
                 %{role: "user", content: "hi"},
                 %{role: "assistant", content: "yo"}
               ],
               runner: runner,
               workspace: "/tmp"
             )
  end

  test "auto_eligible? requires flag, no prior auto stamp, and title_user_set not true" do
    eligible = %{
      title: "Chat · GAM-20 · Fix login race",
      metadata: %{"title_auto_eligible" => true}
    }

    assert TitleGenerator.auto_eligible?(eligible)

    assert TitleGenerator.auto_eligible?(%{
             title: "Custom name",
             metadata: %{"title_auto_eligible" => true}
           })

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{}
           })

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{
               "title_auto_eligible" => true,
               "title_auto_generated_at" => "2026-07-16T00:00:00Z"
             }
           })

    refute TitleGenerator.auto_eligible?(%{
             title: "Chat · GAM-20 · Fix login race",
             metadata: %{
               "title_auto_eligible" => true,
               "title_user_set" => true
             }
           })
  end
end
