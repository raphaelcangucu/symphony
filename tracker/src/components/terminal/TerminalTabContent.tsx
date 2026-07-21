import { TerminalView } from "@/components/terminal/TerminalView";
import type { WorkspaceTab } from "@/lib/workspaceTabs/types";

interface TerminalTabContentProps {
  activeTab: WorkspaceTab | null;
  activeTabId: string;
  projectSlug: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function TerminalTabContent({ activeTab, activeTabId, projectSlug, t }: TerminalTabContentProps) {
  if (activeTab?.kind === "issue-terminal") {
    return (
      <TerminalView
        key={activeTab.id}
        kind="issue"
        projectSlug={projectSlug}
        issueIdentifier={activeTab.issueIdentifier}
        enabled={activeTabId === activeTab.id}
        ariaLabel={t("issue.terminal.ariaLabel", { identifier: activeTab.issueIdentifier })}
      />
    );
  }

  if (activeTab?.kind === "thread-terminal") {
    return (
      <TerminalView
        key={activeTab.id}
        kind="thread"
        projectSlug={projectSlug}
        threadId={activeTab.threadId}
        enabled={activeTabId === activeTab.id}
        ariaLabel={t("workspace.terminal.threadAriaLabel", {
          threadId: String(activeTab.threadId),
        })}
      />
    );
  }

  if (activeTab?.kind === "project-terminal") {
    return (
      <TerminalView
        key={activeTab.id}
        kind="project-devenv"
        projectSlug={projectSlug}
        enabled={activeTabId === activeTab.id}
        ariaLabel={t("workspace.terminal.projectAriaLabel", { project: projectSlug })}
      />
    );
  }

  if (activeTab?.kind === "dynamic-terminal") {
    return (
      <TerminalView
        key={activeTab.id}
        kind="dynamic-tab"
        projectSlug={projectSlug}
        issueIdentifier={activeTab.issueIdentifier}
        tabId={activeTab.tabId}
        enabled={activeTabId === activeTab.id}
        ariaLabel={t("workspace.terminal.dynamicAriaLabel", { title: activeTab.title })}
      />
    );
  }

  return null;
}
