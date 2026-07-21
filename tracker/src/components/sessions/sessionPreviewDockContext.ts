import { createContext, useContext } from "react";

import type { WorkspaceScope } from "@/lib/workspaceScope";

export interface SessionPreviewDockControls {
  /** Workspace scope whose preview dock is currently open, if any. */
  openScope: WorkspaceScope | null;
  /** Opens the dock for the scope, or closes it when it is already open for that scope. */
  togglePreview: (scope: WorkspaceScope) => void;
}

export const SessionPreviewDockContext = createContext<SessionPreviewDockControls | null>(null);

/**
 * Returns the workspace-level preview dock controls, or null when the session
 * content renders outside a dock-aware workspace (toolbar falls back to the
 * issue preview tab link in that case).
 */
export function useSessionPreviewDock(): SessionPreviewDockControls | null {
  return useContext(SessionPreviewDockContext);
}
