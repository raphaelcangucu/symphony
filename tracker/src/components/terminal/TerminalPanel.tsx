import { IssueTerminal } from "./IssueTerminal";

interface TerminalPanelProps {
  projectSlug: string;
  issueIdentifier: string;
}

export function TerminalPanel({ projectSlug, issueIdentifier }: TerminalPanelProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Issue Terminal</h3>
        <p className="text-xs text-muted-foreground">Runs in the issue workspace through tmux.</p>
      </div>
      <IssueTerminal projectSlug={projectSlug} issueIdentifier={issueIdentifier} />
    </section>
  );
}
