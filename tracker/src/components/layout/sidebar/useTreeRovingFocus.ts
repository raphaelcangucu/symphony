import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefCallback,
} from "react";

import type { SidebarVisibleRow } from "@/components/layout/sidebar/sidebarVisibleRows";

export interface TreeRovingFocus {
  readonly focusedId: string | null;
  readonly tabStopId: string | null;
  focusRow(id: string): void;
  registerRow(id: string): RefCallback<HTMLDivElement>;
  rowElement(id: string): HTMLDivElement | null;
  noteRowFocus(id: string): void;
  onTreeFocusCapture(event: FocusEvent<HTMLDivElement>): void;
  onTreeBlurCapture(event: FocusEvent<HTMLDivElement>): void;
}

export function useTreeRovingFocus(
  rows: readonly SidebarVisibleRow[],
  selectedId: string | null,
): TreeRovingFocus {
  const [focusedId, setFocusedId] = useState<string | null>(
    () => selectedId ?? rows[0]?.id ?? null,
  );
  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const registrarsRef = useRef(new Map<string, RefCallback<HTMLDivElement>>());
  const previousRowsRef = useRef(rows);
  const pendingIdRef = useRef<string | null>(null);
  const restoreFocusIdRef = useRef<string | null>(null);
  const treeOwnsFocusRef = useRef(false);
  const mountedRef = useRef(false);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const visibleIds = useMemo(() => new Set(rows.map(({ id }) => id)), [rows]);
  const tabStopId = focusedId && visibleIds.has(focusedId)
    ? focusedId
    : selectedId && visibleIds.has(selectedId)
      ? selectedId
      : rows[0]?.id ?? null;

  const registerRow = useCallback((id: string): RefCallback<HTMLDivElement> => {
    const existing = registrarsRef.current.get(id);
    if (existing) return existing;
    const registrar: RefCallback<HTMLDivElement> = (element) => {
      if (element) elementsRef.current.set(id, element);
      else elementsRef.current.delete(id);
    };
    registrarsRef.current.set(id, registrar);
    return registrar;
  }, []);

  const focusRow = useCallback((id: string) => {
    const target = elementsRef.current.get(id);
    if (target) {
      pendingIdRef.current = null;
      setFocusedId(id);
      if (typeof document !== "undefined" && document.activeElement !== target) {
        target.focus();
      }
      return;
    }
    pendingIdRef.current = id;
    setFocusedId(id);
  }, []);

  const rowElement = useCallback(
    (id: string) => elementsRef.current.get(id) ?? null,
    [],
  );
  const noteRowFocus = useCallback((id: string) => {
    setFocusedId(id);
  }, []);
  const onTreeFocusCapture = useCallback((_event: FocusEvent<HTMLDivElement>) => {
    treeOwnsFocusRef.current = true;
  }, []);
  const onTreeBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    if (
      nextTarget instanceof Node &&
      (typeof document === "undefined" || nextTarget !== document.body)
    ) {
      treeOwnsFocusRef.current = false;
      pendingIdRef.current = null;
      restoreFocusIdRef.current = null;
      return;
    }
    const treeRoot = event.currentTarget;
    const focusedRowId = focusedIdRef.current;
    const originTreeItem = focusedRowId
      ? elementsRef.current.get(focusedRowId) ?? null
      : null;
    queueMicrotask(() => {
      if (!mountedRef.current || typeof document === "undefined") return;
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body) {
        if (treeRoot.contains(activeElement)) return;
        treeOwnsFocusRef.current = false;
        pendingIdRef.current = null;
        restoreFocusIdRef.current = null;
        return;
      }
      if (!originTreeItem || originTreeItem.isConnected) {
        treeOwnsFocusRef.current = false;
        pendingIdRef.current = null;
        restoreFocusIdRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      treeOwnsFocusRef.current = false;
      pendingIdRef.current = null;
      restoreFocusIdRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (focusedId && visibleIds.has(focusedId)) {
      previousRowsRef.current = rows;
      const pending = pendingIdRef.current;
      if (pending === focusedId) {
        const target = elementsRef.current.get(focusedId);
        if (target) {
          pendingIdRef.current = null;
          if (typeof document !== "undefined" && document.activeElement !== target) {
            target.focus();
          }
        }
      }
      return;
    }

    const fallback = fallbackId(focusedId, previousRowsRef.current, rows, selectedId);
    previousRowsRef.current = rows;
    const target = fallback ? elementsRef.current.get(fallback) : undefined;
    pendingIdRef.current = target ? null : fallback;
    restoreFocusIdRef.current = treeOwnsFocusRef.current ? fallback : null;
    setFocusedId(fallback);
  }, [focusedId, rows, selectedId, visibleIds]);

  useEffect(() => {
    const restoreId = restoreFocusIdRef.current;
    if (!restoreId || !treeOwnsFocusRef.current) return;
    const target = elementsRef.current.get(restoreId);
    if (!target) return;
    restoreFocusIdRef.current = null;
    pendingIdRef.current = null;
    if (typeof document !== "undefined" && document.activeElement !== target) {
      target.focus();
    }
  }, [focusedId, rows]);

  useEffect(() => {
    if (!treeOwnsFocusRef.current || !tabStopId) return;
    if (typeof document === "undefined") return;
    if (document.activeElement !== document.body) return;
    elementsRef.current.get(tabStopId)?.focus();
  }, [rows, tabStopId]);

  return useMemo(
    () => ({
      focusedId,
      tabStopId,
      focusRow,
      registerRow,
      rowElement,
      noteRowFocus,
      onTreeFocusCapture,
      onTreeBlurCapture,
    }),
    [
      focusRow,
      focusedId,
      noteRowFocus,
      onTreeBlurCapture,
      onTreeFocusCapture,
      registerRow,
      rowElement,
      tabStopId,
    ],
  );
}

function fallbackId(
  missingId: string | null,
  previousRows: readonly SidebarVisibleRow[],
  nextRows: readonly SidebarVisibleRow[],
  selectedId: string | null,
): string | null {
  if (nextRows.length === 0) return null;
  const nextIds = new Set(nextRows.map(({ id }) => id));
  let previous = previousRows.find(({ id }) => id === missingId);
  while (previous?.parentId) {
    if (nextIds.has(previous.parentId)) return previous.parentId;
    previous = previousRows.find(({ id }) => id === previous?.parentId);
  }
  if (selectedId && nextIds.has(selectedId)) return selectedId;
  const previousIndex = previousRows.findIndex(({ id }) => id === missingId);
  if (previousIndex < 0) return nextRows[0].id;
  return nextRows[Math.min(previousIndex, nextRows.length - 1)]?.id ?? nextRows[0].id;
}
