import { createContext, useContext } from "react";

export interface SessionEnvironmentDockControls {
  /** Issue whose environment dock is currently open at the workspace level, if any. */
  openIssueIdentifier: string | null;
  /** Opens the dock for the issue, or closes it when it is already open for that issue. */
  toggleEnvironment: (issueIdentifier: string) => void;
}

export const SessionEnvironmentDockContext = createContext<SessionEnvironmentDockControls | null>(null);

/**
 * Returns the workspace-level environment dock controls, or null when the session
 * content renders outside a dock-aware workspace (toolbar hides the control).
 */
export function useSessionEnvironmentDock(): SessionEnvironmentDockControls | null {
  return useContext(SessionEnvironmentDockContext);
}
