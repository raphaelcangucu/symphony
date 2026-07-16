import { useMemo, useState } from "react";

import { TurnSummaryStrip } from "@/components/agent-activity/typed-tools/TurnSummaryStrip";
import { renderTypedToolCard } from "@/components/agent-activity/typed-tools/renderTypedToolCard";
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { cn } from "@/lib/utils";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";
import type { ToolPresentation } from "@/lib/toolCallPresentation";
import {
  TOOL_CALL_PROPOSAL_FIXTURES,
  TOOL_CALL_PROPOSAL_TABS,
  type ToolCallProposalTab,
} from "@/pages/toolCallProposalFixtures";
import type { AssistantToolCall } from "@/services/assistant";

export function ToolCallProposalsPage() {
  const [tab, setTab] = useState<ToolCallProposalTab>("mixed");
  const fixture = TOOL_CALL_PROPOSAL_FIXTURES[tab];
  const presentations = useMemo(
    () => fixture.calls.map((toolCall) => canonicalizeFromAssistant(toolCall)),
    [fixture.calls],
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 p-6">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Design sandbox · typed tool cards
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Tool call proposals — before / after
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Compare raw ENT/SAÍ blocks with canonical typed cards and the turn summary strip. Fixtures
          inspired by CDE-1180 (Bash, manage_preview, set_issue_status, kb_*, manage_dev_env).
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TOOL_CALL_PROPOSAL_TABS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              tab === tabId
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(tabId)}
          >
            {TOOL_CALL_PROPOSAL_FIXTURES[tabId].label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0 space-y-3">
          <ColumnHeader title="Before" subtitle="ToolCallBlock · raw JSON ENT/SAÍ" />
          <div className="space-y-2 rounded-xl border border-border bg-background p-3">
            {fixture.calls.map((toolCall) => (
              <ToolCallBlock
                key={toolCall.id ?? toolCall.name}
                view={assistantToolCallToView(toolCall)}
                toolCallId={toolCall.id}
              />
            ))}
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <ColumnHeader title="After" subtitle="canonicalize → typed cards + turn summary" />
          <div className="space-y-2 rounded-xl border border-border bg-background p-3">
            <TurnSummaryStrip presentations={presentations} durationMs={fixture.durationMs} />
            {presentations.map((presentation, index) => (
              <div key={`${presentation.toolName}-${index}`} className="min-w-0">
                {renderTypedToolCard(presentation)}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ColumnHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </div>
  );
}

function canonicalizeFromAssistant(toolCall: AssistantToolCall): ToolPresentation {
  return canonicalizeToolCall({
    name: toolCall.name,
    arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
    output: toolCall.output ?? null,
    status: toolCall.status,
    result: toolCall.result,
    outputTruncated: toolCall.outputTruncated,
    outputByteSize: toolCall.outputByteSize ?? null,
  });
}
