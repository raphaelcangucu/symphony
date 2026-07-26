defmodule SymphonyElixir.MobileRpc.Methods.MobileSessions do
  @moduledoc "Orca-compatible session-tab and markdown operations."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.TabsList,
      __MODULE__.TabsSubscribe,
      __MODULE__.TabsActivate,
      __MODULE__.TabsCreateTerminal,
      __MODULE__.TabsClose,
      __MODULE__.MarkdownReadTab,
      __MODULE__.MarkdownSaveTab
    ]
  end

  defmodule TabsList do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "session.tabs.list",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["worktree"],
      required_keys: ["worktree"]
  end

  defmodule TabsSubscribe do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "session.tabs.subscribe",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      subscription: true,
      allowed_keys: ["worktree"],
      required_keys: ["worktree"]
  end

  defmodule TabsActivate do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "session.tabs.activate",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["worktree", "tabId", "leafId", "notifyClients"],
      required_keys: ["worktree", "tabId"]
  end

  defmodule TabsCreateTerminal do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "session.tabs.createTerminal",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      timeout_ms: 30_000,
      allowed_keys: [
        "worktree",
        "afterTabId",
        "targetGroupId",
        "command",
        "cwd",
        "env",
        "startupCommandDelivery",
        "launchConfig",
        "launchToken",
        "agent",
        "launchAgent",
        "activate",
        "clientMutationId"
      ],
      required_keys: ["worktree"]
  end

  defmodule TabsClose do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "session.tabs.close",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["worktree", "tabId", "leafId", "notifyClients"],
      required_keys: ["worktree", "tabId"]
  end

  defmodule MarkdownReadTab do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "markdown.readTab",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["worktree", "tabId", "leafId", "notifyClients"],
      required_keys: ["worktree", "tabId"]
  end

  defmodule MarkdownSaveTab do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "markdown.saveTab",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: [
        "worktree",
        "tabId",
        "leafId",
        "notifyClients",
        "baseVersion",
        "content"
      ],
      required_keys: ["worktree", "tabId", "baseVersion", "content"]
  end
end
