import { createContext, useContext } from "react";

import type { WorkspaceScope } from "@/lib/workspaceScope";

export interface SessionTasksDockControls {
  /** Workspace scope whose tasks/tools dock is currently open, if any. */
  openScope: WorkspaceScope | null;
  /** Opens the dock for the scope, or closes it when it is already open for that scope. */
  toggleTasks: (scope: WorkspaceScope) => void;
}

export const SessionTasksDockContext = createContext<SessionTasksDockControls | null>(null);

/**
 * Returns the workspace-level tasks/tools dock controls, or null when the session
 * content renders outside a dock-aware workspace.
 */
export function useSessionTasksDock(): SessionTasksDockControls | null {
  return useContext(SessionTasksDockContext);
}
