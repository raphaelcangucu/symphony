import { createContext, useContext } from "react";

import type { WorkspaceScope } from "@/lib/workspaceScope";

export interface SessionTerminalDockControls {
  /** Workspace scope whose terminal dock is currently open, if any. */
  openScope: WorkspaceScope | null;
  /** Opens the dock for the scope, or closes it when it is already open for that scope. */
  toggleTerminal: (scope: WorkspaceScope) => void;
}

export const SessionTerminalDockContext = createContext<SessionTerminalDockControls | null>(null);

/**
 * Returns the workspace-level terminal dock controls, or null when the session
 * content renders outside a dock-aware workspace (toolbar falls back to the
 * terminal page link in that case).
 */
export function useSessionTerminalDock(): SessionTerminalDockControls | null {
  return useContext(SessionTerminalDockContext);
}
