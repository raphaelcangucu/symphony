import { TerminalSquare } from "lucide-react";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

type CommandToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

export function CommandToolCard({ presentation, ...shellProps }: CommandToolCardProps) {
  const details = presentation.body ? (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
      {presentation.body}
    </pre>
  ) : null;

  return (
    <TypedToolCardShell
      icon={<TerminalSquare className="size-3.5" aria-hidden />}
      verb="Command"
      title={presentation.title}
      summary={presentation.summary}
      status={presentation.status}
      badges={presentation.badges}
      links={presentation.links}
      details={details}
      defaultCollapsed
      {...shellProps}
    />
  );
}
