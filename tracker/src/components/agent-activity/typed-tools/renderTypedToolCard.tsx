import type { ReactNode } from "react";

import { CommandToolCard } from "@/components/agent-activity/typed-tools/CommandToolCard";
import { GenericToolCard } from "@/components/agent-activity/typed-tools/GenericToolCard";
import { PreviewToolCard } from "@/components/agent-activity/typed-tools/PreviewToolCard";
import { SearchToolCard } from "@/components/agent-activity/typed-tools/SearchToolCard";
import type { TypedToolCardShellProps } from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

export type RenderTypedToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
>;

export function renderTypedToolCard(
  presentation: ToolPresentation,
  props: RenderTypedToolCardProps = {},
): ReactNode {
  switch (presentation.family) {
    case "command":
      return <CommandToolCard presentation={presentation} {...props} />;
    case "search":
      return <SearchToolCard presentation={presentation} {...props} />;
    case "preview":
      return <PreviewToolCard presentation={presentation} {...props} />;
    case "generic_mcp":
    case "other":
      return <GenericToolCard presentation={presentation} {...props} />;
    default:
      return null;
  }
}
