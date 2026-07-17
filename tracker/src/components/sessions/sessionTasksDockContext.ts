import { createContext, useContext } from "react";

export interface SessionTasksDockControls {
  /** Issue whose tasks/tools dock is currently open at the workspace level, if any. */
  openIssueIdentifier: string | null;
  /** Opens the dock for the issue, or closes it when it is already open for that issue. */
  toggleTasks: (issueIdentifier: string) => void;
}

export const SessionTasksDockContext = createContext<SessionTasksDockControls | null>(null);

/**
 * Returns the workspace-level tasks/tools dock controls, or null when the session
 * content renders outside a dock-aware workspace.
 */
export function useSessionTasksDock(): SessionTasksDockControls | null {
  return useContext(SessionTasksDockContext);
}
