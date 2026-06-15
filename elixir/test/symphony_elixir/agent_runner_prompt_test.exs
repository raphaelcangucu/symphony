defmodule SymphonyElixir.AgentRunnerPromptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.RunContract.RepoState

  defp states_with_work do
    [struct!(RepoState, %{path: "/w/frontend", name: "frontend", branch: "docs/gam-3", ahead_count: 3, upstream?: false})]
  end

  test "resume_section lists prior work and forbids restart" do
    text = AgentRunner.resume_section(states_with_work())
    assert text =~ "Resume notice"
    assert text =~ "docs/gam-3"
    assert text =~ "Do NOT restart from scratch"
    assert text =~ "VALIDATE/evidence only when"
  end

  test "continuation_prompt embeds deliverable state" do
    text = AgentRunner.continuation_prompt(2, 20, states_with_work())
    assert text =~ "continuation turn #2 of 20"
    assert text =~ "commits_ahead=3"
    assert text =~ "pull request"
  end
end
