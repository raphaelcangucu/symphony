import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createViewModeStorage,
  type MobileViewMode,
  type ViewModeKeyValueStorage,
} from "./view-mode";

type ViewModeContextValue = {
  hydrated: boolean;
  mode: MobileViewMode;
  setMode(mode: MobileViewMode): Promise<void>;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({
  children,
  storage = AsyncStorage,
}: {
  children: ReactNode;
  storage?: ViewModeKeyValueStorage;
}) {
  const persistence = useMemo(() => createViewModeStorage(storage), [storage]);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setModeState] = useState<MobileViewMode>("orca");

  useEffect(() => {
    let active = true;
    void persistence
      .load()
      .then((storedMode) => {
        if (active) setModeState(storedMode);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [persistence]);

  const setMode = useCallback(
    async (nextMode: MobileViewMode) => {
      await persistence.save(nextMode);
      setModeState(nextMode);
    },
    [persistence],
  );

  const value = useMemo(() => ({ hydrated, mode, setMode }), [hydrated, mode, setMode]);

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const value = useContext(ViewModeContext);
  if (!value) throw new Error("useViewMode must be used inside ViewModeProvider");
  return value;
}
