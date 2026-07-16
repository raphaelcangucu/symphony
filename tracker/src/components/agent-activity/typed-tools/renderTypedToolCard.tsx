import type { ReactNode } from "react";

import { BoardToolCard } from "@/components/agent-activity/typed-tools/BoardToolCard";
import { CommandToolCard } from "@/components/agent-activity/typed-tools/CommandToolCard";
import { DevEnvToolCard } from "@/components/agent-activity/typed-tools/DevEnvToolCard";
import { EvidenceToolCard } from "@/components/agent-activity/typed-tools/EvidenceToolCard";
import { GenericToolCard } from "@/components/agent-activity/typed-tools/GenericToolCard";
import { KbToolCard } from "@/components/agent-activity/typed-tools/KbToolCard";
import { PreviewToolCard } from "@/components/agent-activity/typed-tools/PreviewToolCard";
import { SearchToolCard } from "@/components/agent-activity/typed-tools/SearchToolCard";
import { TunnelToolCard } from "@/components/agent-activity/typed-tools/TunnelToolCard";
import type { TypedToolCardShellProps } from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

export type RenderTypedToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  onOpenKbPath?: OpenKbPathHandler;
};

export function renderTypedToolCard(
  presentation: ToolPresentation,
  props: RenderTypedToolCardProps = {},
): ReactNode {
  const { onOpenKbPath, ...shellProps } = props;

  switch (presentation.family) {
    case "command":
      return <CommandToolCard presentation={presentation} {...shellProps} />;
    case "search":
      return <SearchToolCard presentation={presentation} {...shellProps} />;
    case "preview":
      return <PreviewToolCard presentation={presentation} {...shellProps} />;
    case "board_query":
    case "board_action":
    case "acceptance":
      return <BoardToolCard presentation={presentation} {...shellProps} />;
    case "evidence":
      return <EvidenceToolCard presentation={presentation} {...shellProps} />;
    case "kb":
      return <KbToolCard presentation={presentation} onOpenKbPath={onOpenKbPath} {...shellProps} />;
    case "devenv":
      return <DevEnvToolCard presentation={presentation} {...shellProps} />;
    case "tunnel":
      return <TunnelToolCard presentation={presentation} {...shellProps} />;
    case "generic_mcp":
    case "other":
      return <GenericToolCard presentation={presentation} {...shellProps} />;
    default:
      return null;
  }
}
