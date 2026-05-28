import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { ViewerNotConfiguredError, fetchViewer } from "@/services/viewer";
import type { Viewer } from "@/types/viewer";

export type ViewerStatus = "loading" | "ready" | "error";

interface ViewerContextValue {
  viewer: Viewer | null;
  status: ViewerStatus;
  error: ViewerNotConfiguredError | null;
  reload: () => Promise<void>;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

interface ViewerProviderProps {
  children: ReactNode;
}

export function ViewerProvider({ children }: ViewerProviderProps) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [error, setError] = useState<ViewerNotConfiguredError | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await fetchViewer();
      setViewer(next);
      setStatus("ready");
    } catch (cause) {
      if (cause instanceof ViewerNotConfiguredError) {
        setViewer(null);
        setError(cause);
        setStatus("error");
        return;
      }

      throw cause;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <ViewerContext.Provider value={{ viewer, status, error, reload }}>{children}</ViewerContext.Provider>
  );
}

export function useViewer(): ViewerContextValue {
  const ctx = useContext(ViewerContext);
  if (!ctx) {
    throw new Error("useViewer must be used inside a ViewerProvider");
  }
  return ctx;
}

export function useViewerLogin(): string | null {
  const { viewer } = useViewer();
  return viewer?.githubLogin ?? null;
}
