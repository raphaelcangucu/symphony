import { createContext, type Dispatch, type SetStateAction } from "react";

export interface ProjectSessionsChromeState {
  count: number;
  isCreating: boolean;
  isLoading: boolean;
  onCreateSession: () => void;
  onRefresh: () => void;
}

export const ProjectSessionsChromeSetterContext = createContext<
  Dispatch<SetStateAction<ProjectSessionsChromeState | null>> | null
>(null);
