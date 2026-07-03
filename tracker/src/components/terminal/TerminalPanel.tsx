import { TerminalWorkspacePanel } from "./TerminalWorkspacePanel";

interface TerminalPanelProps {
  projectSlug: string;
  issueIdentifier: string;
}

export function TerminalPanel({ projectSlug, issueIdentifier }: TerminalPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TerminalWorkspacePanel
        key={`${projectSlug}:${issueIdentifier}`}
        projectSlug={projectSlug}
        issueIdentifier={issueIdentifier}
      />
    </section>
  );
}
