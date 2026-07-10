import { createContext, type Dispatch, type SetStateAction } from "react";

/** Count badge for the Workspaces nav item while on the sessions page. */
export interface ProjectSessionsChromeState {
  count: number;
}

export const ProjectSessionsChromeSetterContext = createContext<
  Dispatch<SetStateAction<ProjectSessionsChromeState | null>> | null
>(null);
