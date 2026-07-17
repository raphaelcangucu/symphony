import { createContext, useContext } from "react";

import type { SubagentRef } from "@/lib/subagentRef";

export interface SubagentDrawerController {
  openSubagent: (ref: SubagentRef) => void;
  /** Session's agent kind, used when the ref itself doesn't imply one. */
  agentKind: string | null;
}

export const SubagentDrawerContext = createContext<SubagentDrawerController | null>(null);

/** Returns the drawer controller, or null when no provider is mounted (button stays hidden). */
export function useSubagentDrawer(): SubagentDrawerController | null {
  return useContext(SubagentDrawerContext);
}
