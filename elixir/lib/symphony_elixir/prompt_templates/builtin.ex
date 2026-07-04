defmodule SymphonyElixir.PromptTemplates.Builtin do
  @moduledoc "Built-in prompt templates used by Magic Commands."

  @templates [
    %{
      slug: "investigate-issue",
      name: "Investigate issue",
      description: "Diagnose root cause and propose a fix path.",
      category: "analysis",
      body: """
      Investigate issue {{ issue.identifier }}: {{ issue.title }}.

      Read the available context, identify the most likely root cause, list evidence, and propose a minimal-risk implementation plan.
      If information is missing, state exactly what is missing and why it blocks confidence.
      """,
      agent_kind: "codex",
      model: nil,
      effort: "medium",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 10
    },
    %{
      slug: "code-review",
      name: "Code review",
      description: "Review implementation risks and correctness gaps.",
      category: "review",
      body: """
      Review the changes for issue {{ issue.identifier }}: {{ issue.title }}.

      Prioritize findings by severity (blocker, major, minor, nit), cite concrete file references, and explain behavioral impact.
      Include missing tests and a short recommendation for each actionable finding.
      """,
      agent_kind: "codex",
      model: nil,
      effort: "high",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 20
    },
    %{
      slug: "commit-message",
      name: "Commit message",
      description: "Generate a concise commit message for current changes.",
      category: "git",
      body: """
      Draft a concise conventional commit message for issue {{ issue.identifier }} ({{ issue.title }}).
      Focus on why the change was made. Return only the final commit message.
      """,
      agent_kind: "codex",
      model: nil,
      effort: "low",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 30
    },
    %{
      slug: "pr-description",
      name: "PR description",
      description: "Draft a pull request summary and test plan.",
      category: "git",
      body: """
      Write a pull request description for issue {{ issue.identifier }}: {{ issue.title }}.

      Include:
      - Summary of user-visible and technical changes
      - Key risks or rollout notes
      - A practical test plan checklist
      """,
      agent_kind: "codex",
      model: nil,
      effort: "medium",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 40
    },
    %{
      slug: "release-notes",
      name: "Release notes",
      description: "Prepare release notes from completed work.",
      category: "release",
      body: """
      Create release notes for issue {{ issue.identifier }}: {{ issue.title }}.

      Write customer-facing highlights first, then technical notes, then migration or operational considerations if any.
      Keep the tone concise and clear.
      """,
      agent_kind: "codex",
      model: nil,
      effort: "medium",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 50
    },
    %{
      slug: "resolve-conflicts",
      name: "Resolve conflicts",
      description: "Guide safe merge-conflict resolution.",
      category: "git",
      body: """
      Resolve merge conflicts related to issue {{ issue.identifier }}: {{ issue.title }}.

      Keep intent from both branches, preserve behavior, and call out any semantic decisions made while resolving conflicts.
      After resolving, suggest focused verification commands.
      """,
      agent_kind: "codex",
      model: nil,
      effort: "high",
      mode: "build",
      scope: "global",
      built_in: true,
      enabled: true,
      position: 60
    }
  ]

  @spec all() :: [map()]
  def all, do: @templates
end
