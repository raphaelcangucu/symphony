import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import type { Issue } from "@/types/issue";

interface TerminalTabProps {
  issue: Issue;
}

export function TerminalTab({ issue }: TerminalTabProps) {
  return <TerminalPanel projectSlug={issue.projectSlug} issueIdentifier={issue.identifier} />;
}
