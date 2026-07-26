defmodule SymphonyElixir.MobileRpc.Methods.OrcaGit do
  @moduledoc "Orca-compatible source-control and hosted-review operations."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.Status,
      __MODULE__.Diff,
      __MODULE__.BranchDiff,
      __MODULE__.BranchCompare,
      __MODULE__.CommitCompare,
      __MODULE__.History,
      __MODULE__.Stage,
      __MODULE__.Commit,
      __MODULE__.Push,
      __MODULE__.GenerateCommitMessage,
      __MODULE__.CancelGenerateCommitMessage,
      __MODULE__.GeneratePullRequestFields,
      __MODULE__.HostedReviewCreationEligibility
    ]
  end

  defmodule Status do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.status",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "includeIgnored", "bypassEffectiveUpstreamNegativeCache"],
      required_keys: ["worktree"]
  end

  defmodule Diff do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.diff",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "filePath", "staged", "compareAgainstHead"],
      required_keys: ["worktree", "filePath", "staged"]
  end

  defmodule BranchDiff do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.branchDiff",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "filePath", "oldPath", "compare"],
      required_keys: ["worktree", "filePath", "compare"]
  end

  defmodule BranchCompare do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.branchCompare",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "baseRef"],
      required_keys: ["worktree", "baseRef"]
  end

  defmodule CommitCompare do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.commitCompare",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "commitId"],
      required_keys: ["worktree", "commitId"]
  end

  defmodule History do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.history",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "limit", "baseRef"],
      required_keys: ["worktree"]
  end

  defmodule Stage do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.stage",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "filePath"],
      required_keys: ["worktree", "filePath"]
  end

  defmodule Commit do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.commit",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "message"],
      required_keys: ["worktree", "message"],
      timeout_ms: 30_000
  end

  defmodule Push do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.push",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree", "publish", "pushTarget", "forceWithLease"],
      required_keys: ["worktree"],
      timeout_ms: 60_000
  end

  defmodule GenerateCommitMessage do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.generateCommitMessage",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: [
        "worktree",
        "commitMessageAi",
        "sourceControlAi",
        "sourceControlAiResolvedParams",
        "agentCmdOverrides",
        "enableGitHubAttribution",
        "commitMessageDiscoveryHostKey"
      ],
      required_keys: ["worktree"],
      timeout_ms: 60_000
  end

  defmodule CancelGenerateCommitMessage do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.cancelGenerateCommitMessage",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: ["worktree"],
      required_keys: ["worktree"]
  end

  defmodule GeneratePullRequestFields do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "git.generatePullRequestFields",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: [
        "worktree",
        "base",
        "title",
        "body",
        "draft",
        "provider",
        "useTemplate",
        "commitMessageAi",
        "sourceControlAi",
        "sourceControlAiResolvedParams",
        "agentCmdOverrides",
        "enableGitHubAttribution",
        "commitMessageDiscoveryHostKey"
      ],
      required_keys: ["worktree", "base", "title", "body", "draft"],
      nullable_required_keys: ["title", "body"],
      timeout_ms: 60_000
  end

  defmodule HostedReviewCreationEligibility do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "hostedReview.getCreationEligibility",
      service: SymphonyElixir.MobileRpc.OrcaGitService,
      service_key: :orca_git_service,
      allowed_keys: [
        "repo",
        "worktree",
        "branch",
        "base",
        "hasUncommittedChanges",
        "hasUpstream",
        "ahead",
        "behind",
        "linkedGitHubPR",
        "fallbackGitHubPR",
        "linkedGitLabMR",
        "linkedBitbucketPR",
        "linkedAzureDevOpsPR",
        "linkedGiteaPR"
      ],
      required_keys: ["repo", "branch"]
  end
end
