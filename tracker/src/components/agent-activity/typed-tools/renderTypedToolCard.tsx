import type { ReactNode } from "react";

import { GenericToolCard } from "@/components/agent-activity/typed-tools/GenericToolCard";
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
  if (presentation.family === "generic_mcp" || presentation.family === "other") {
    return <GenericToolCard presentation={presentation} {...props} />;
  }
  return null;
}
