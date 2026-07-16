import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

type ExtraGetter = () => Record<string, unknown> | undefined;

interface MaestroExtraContextValue {
  register: (getter: ExtraGetter) => () => void;
  getExtra: () => Record<string, unknown>;
}

const MaestroExtraContextRef = createContext<MaestroExtraContextValue | null>(null);

/**
 * Lets route-level surfaces (KB editor, Observability, board) publish a lazy
 * getter whose result is merged into every Maestro message context at send
 * time. Mirrors the KB live-snapshot pattern, but decoupled from the host so
 * pages don't need to know about the docked panel.
 */
export function MaestroExtraContextProvider({ children }: { children: ReactNode }) {
  const getters = useRef<Set<ExtraGetter>>(new Set());

  const register = useCallback((getter: ExtraGetter) => {
    getters.current.add(getter);
    return () => {
      getters.current.delete(getter);
    };
  }, []);

  const getExtra = useCallback(() => {
    let merged: Record<string, unknown> = {};
    for (const getter of getters.current) {
      const value = getter();
      if (value) merged = { ...merged, ...value };
    }
    return merged;
  }, []);

  const value = useMemo<MaestroExtraContextValue>(() => ({ register, getExtra }), [register, getExtra]);

  return <MaestroExtraContextRef.Provider value={value}>{children}</MaestroExtraContextRef.Provider>;
}

/**
 * Registers a page-scoped extra-context getter for the lifetime of the calling
 * component. `deps` control when the getter identity is refreshed.
 */
export function useRegisterMaestroExtra(getter: ExtraGetter, deps: ReadonlyArray<unknown>): void {
  const ctx = useContext(MaestroExtraContextRef);
  const getterRef = useRef(getter);
  getterRef.current = getter;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(() => getterRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}

/** Returns a merge of all registered getters; a no-op when no provider is present. */
export function useMaestroExtraGetter(): () => Record<string, unknown> {
  const ctx = useContext(MaestroExtraContextRef);
  return ctx?.getExtra ?? emptyExtra;
}

function emptyExtra(): Record<string, unknown> {
  return {};
}
