import { createContext, useContext } from "react";

export interface SessionPreviewDockControls {
  /** Issue whose preview dock is currently open at the workspace level, if any. */
  openIssueIdentifier: string | null;
  /** Opens the dock for the issue, or closes it when it is already open for that issue. */
  togglePreview: (issueIdentifier: string) => void;
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
