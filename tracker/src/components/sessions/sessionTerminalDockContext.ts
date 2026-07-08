import { createContext, useContext } from "react";

export interface SessionTerminalDockControls {
  /** Issue whose terminal dock is currently open at the workspace level, if any. */
  openIssueIdentifier: string | null;
  /** Opens the dock for the issue, or closes it when it is already open for that issue. */
  toggleTerminal: (issueIdentifier: string) => void;
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
