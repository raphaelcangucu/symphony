import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "symphony:board:collapsed:";

function storageKey(projectSlug: string): string {
  return `${STORAGE_PREFIX}${projectSlug}`;
}

function readCollapsed(projectSlug: string): string[] {
  if (!projectSlug.trim() || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(projectSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export interface UseCollapsedColumnsResult {
  collapsed: ReadonlySet<string>;
  toggle: (status: string) => void;
}

export function useCollapsedColumns(projectSlug: string): UseCollapsedColumnsResult {
  const [collapsedList, setCollapsedList] = useState<string[]>(() => readCollapsed(projectSlug));

  useEffect(() => {
    setCollapsedList(readCollapsed(projectSlug));
  }, [projectSlug]);

  useEffect(() => {
    if (!projectSlug.trim() || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(projectSlug), JSON.stringify(collapsedList));
    } catch {
      /* storage is best-effort */
    }
  }, [projectSlug, collapsedList]);

  const toggle = useCallback((status: string) => {
    if (!status.trim()) return;
    setCollapsedList((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }, []);

  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

  return { collapsed, toggle };
}
