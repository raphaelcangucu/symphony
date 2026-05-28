import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

interface DrawerState {
  open: boolean;
  focusSearchSignal: number;
}

interface DrawerContextValue extends DrawerState {
  setOpen: (next: boolean) => void;
  openAndFocusSearch: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

interface BoardFiltersDrawerProviderProps {
  children: ReactNode;
}

export function BoardFiltersDrawerProvider({ children }: BoardFiltersDrawerProviderProps) {
  const [state, setState] = useState<DrawerState>({ open: false, focusSearchSignal: 0 });

  const setOpen = useCallback((next: boolean) => {
    setState((current) => ({ ...current, open: next }));
  }, []);

  const openAndFocusSearch = useCallback(() => {
    setState((current) => ({ open: true, focusSearchSignal: current.focusSearchSignal + 1 }));
  }, []);

  const value = useMemo<DrawerContextValue>(
    () => ({ ...state, setOpen, openAndFocusSearch }),
    [state, setOpen, openAndFocusSearch],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useBoardFiltersDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useBoardFiltersDrawer must be used inside BoardFiltersDrawerProvider");
  return ctx;
}
