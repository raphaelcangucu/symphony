defmodule SymphonyElixir.MobileRpc.Methods.MobileWorkspaces do
  @moduledoc "Orca-compatible repository, UI-state and workspace methods."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.RepoList,
      __MODULE__.RepoHooks,
      __MODULE__.RepoSearchRefs,
      __MODULE__.RepoBaseRefDefault,
      __MODULE__.RepoSparsePresets,
      __MODULE__.RepoSaveSparsePreset,
      __MODULE__.UiGet,
      __MODULE__.UiSet,
      __MODULE__.WorktreePs,
      __MODULE__.WorktreeShow,
      __MODULE__.WorktreeCreate,
      __MODULE__.WorktreeActivate,
      __MODULE__.WorktreeSet,
      __MODULE__.WorktreeSleep,
      __MODULE__.WorktreeRemove
    ]
  end

  defmodule RepoList do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "repo.list"
  end

  defmodule RepoHooks do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "repo.hooks",
      allowed_keys: ["repo"],
      required_keys: ["repo"]
  end

  defmodule RepoSearchRefs do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "repo.searchRefs",
      allowed_keys: ["repo", "query", "limit"],
      required_keys: ["repo", "query"]
  end

  defmodule RepoBaseRefDefault do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "repo.baseRefDefault",
      allowed_keys: ["repo"],
      required_keys: ["repo"]
  end

  defmodule RepoSparsePresets do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "repo.sparsePresets",
      allowed_keys: ["repo"],
      required_keys: ["repo"]
  end

  defmodule RepoSaveSparsePreset do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "repo.saveSparsePreset",
      allowed_keys: ["repo", "id", "name", "directories"],
      required_keys: ["repo", "name", "directories"]
  end

  defmodule UiGet do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "ui.get"
  end

  defmodule UiSet do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "ui.set",
      allowed_keys: [
        "taskResumeState",
        "trustedOrcaHooks",
        "groupBy",
        "sortBy",
        "hideSleepingWorkspaces",
        "hideDefaultBranchWorkspace",
        "sortMode",
        "hideSleeping",
        "hideDefaultBranch",
        "filterRepoIds",
        "collapsedGroups",
        "workspaceStatuses",
        "collapsedRepoIds",
        "workspaceViewMode"
      ]
  end

  defmodule WorktreePs do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.ps",
      allowed_keys: ["limit"]
  end

  defmodule WorktreeShow do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.show",
      allowed_keys: ["worktree"],
      required_keys: ["worktree"]
  end

  defmodule WorktreeCreate do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.create",
      timeout_ms: 120_000,
      allowed_keys: [
        "repo",
        "name",
        "comment",
        "createdWithAgent",
        "activate",
        "displayName",
        "startupDraft",
        "startupCommand",
        "setupDecision",
        "baseRef",
        "branchNameOverride",
        "sparseDirectories",
        "sparseBaseRef",
        "sparsePresetId",
        "sparseCheckout",
        "linkedIssue",
        "linkedLinearIssue",
        "linkedGitLabIssue",
        "linkedGitLabMR",
        "linkedBitbucketPR",
        "linkedAzureDevOpsPR",
        "linkedGiteaPR",
        "pushTarget",
        "clientRequestId"
      ],
      required_keys: ["repo", "name"]
  end

  defmodule WorktreeActivate do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.activate",
      allowed_keys: ["worktree", "notifyClients"],
      required_keys: ["worktree"]
  end

  defmodule WorktreeSet do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.set",
      allowed_keys: [
        "worktree",
        "displayName",
        "comment",
        "isPinned",
        "isUnread",
        "status",
        "linkedPR",
        "linkedIssue",
        "linkedLinearIssue",
        "linkedGitLabIssue",
        "linkedGitLabMR",
        "linkedBitbucketPR",
        "linkedAzureDevOpsPR",
        "linkedGiteaPR",
        "diffComments",
        "mobileDiffReview",
        "baseRef",
        "pushTarget"
      ],
      required_keys: ["worktree"]
  end

  defmodule WorktreeSleep do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.sleep",
      allowed_keys: ["worktree"],
      required_keys: ["worktree"]
  end

  defmodule WorktreeRemove do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "worktree.rm",
      allowed_keys: ["worktree", "force"],
      required_keys: ["worktree"]
  end
end
