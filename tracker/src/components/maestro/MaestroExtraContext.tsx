import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Getters may return a named interface (e.g. KbExtraContext) or an inline
// object literal; `object` accepts both, unlike Record<string, unknown> which
// rejects interfaces lacking an index signature.
type ExtraGetter = () => object | undefined;

/** Imperative control the docked host exposes so page toolbars can open it. */
export interface MaestroHostControl {
  openPanel: () => void;
}

/** Page-provided callbacks the host forwards to the KB-bound panel. */
export interface MaestroKbHandlers {
  onDocumentChanged?: () => void;
}

interface MaestroExtraContextValue {
  register: (getter: ExtraGetter) => () => void;
  getExtra: () => Record<string, unknown>;
  hostControl: MaestroHostControl | null;
  setHostControl: (control: MaestroHostControl | null) => void;
  kbHandlers: MaestroKbHandlers | null;
  setKbHandlers: (handlers: MaestroKbHandlers | null) => void;
}

const MaestroExtraContextRef = createContext<MaestroExtraContextValue | null>(null);

/**
 * Bridges route-level surfaces to the docked Maestro host without coupling
 * pages to the host component:
 *
 * - **extra context getters** — merged into every message (KB live snapshot,
 *   observability filter, board/issue location).
 * - **host control** — lets a page toolbar (e.g. the KB editor "Ask AI" button)
 *   open the docked panel.
 * - **KB handlers** — page callbacks (reload on document change) the host wires
 *   into the KB-bound panel.
 *
 * Host control and KB handlers change only on page/host mount, so the rare
 * provider re-render they cause does not affect per-toggle performance (the
 * open state lives inside the host).
 */
export function MaestroExtraContextProvider({ children }: { children: ReactNode }) {
  const getters = useRef<Set<ExtraGetter>>(new Set());
  const [hostControl, setHostControl] = useState<MaestroHostControl | null>(null);
  const [kbHandlers, setKbHandlers] = useState<MaestroKbHandlers | null>(null);

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

  const value = useMemo<MaestroExtraContextValue>(
    () => ({ register, getExtra, hostControl, setHostControl, kbHandlers, setKbHandlers }),
    [register, getExtra, hostControl, kbHandlers],
  );

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

/**
 * The host registers its open control here; page toolbars read the returned
 * `openPanel` to reveal the docked Maestro.
 */
export function useMaestroHostControl(): {
  hostControl: MaestroHostControl | null;
  setHostControl: (control: MaestroHostControl | null) => void;
} {
  const ctx = useContext(MaestroExtraContextRef);
  return {
    hostControl: ctx?.hostControl ?? null,
    setHostControl: ctx?.setHostControl ?? noopSetHostControl,
  };
}

/** Registers KB page handlers for the lifetime of the calling component. */
export function useSetMaestroKbHandlers(handlers: MaestroKbHandlers | null, deps: ReadonlyArray<unknown>): void {
  const ctx = useContext(MaestroExtraContextRef);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!ctx) return;
    ctx.setKbHandlers(handlersRef.current);
    return () => ctx.setKbHandlers(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}

/** Reads the currently registered KB handlers (used by the host). */
export function useMaestroKbHandlers(): MaestroKbHandlers | null {
  const ctx = useContext(MaestroExtraContextRef);
  return ctx?.kbHandlers ?? null;
}

function emptyExtra(): Record<string, unknown> {
  return {};
}

function noopSetHostControl(): void {
  // No provider mounted; page toolbars silently no-op.
}
