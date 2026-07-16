import { Search } from "lucide-react";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

type SearchToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

export function SearchToolCard({ presentation, ...shellProps }: SearchToolCardProps) {
  const { body, raw } = presentation;
  const details =
    body || raw ? (
      <div className="min-w-0 space-y-2">
        {body ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
            {body}
          </pre>
        ) : null}
        {raw ? (
          <div className="min-w-0 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Technical details
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
              {raw}
            </pre>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <TypedToolCardShell
      icon={<Search className="size-3.5" aria-hidden />}
      verb="Search"
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
