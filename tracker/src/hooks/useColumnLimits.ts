import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "symphony:board:limits:";

function storageKey(projectSlug: string): string {
  return `${STORAGE_PREFIX}${projectSlug}`;
}

function readLimits(projectSlug: string): Record<string, number> {
  if (!projectSlug.trim() || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(projectSlug));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) result[key] = Math.floor(value);
    }
    return result;
  } catch {
    return {};
  }
}

export interface UseColumnLimitsResult {
  limits: Readonly<Record<string, number>>;
  setLimit: (status: string, limit: number | null) => void;
}

export function useColumnLimits(projectSlug: string): UseColumnLimitsResult {
  const [limits, setLimits] = useState<Record<string, number>>(() => readLimits(projectSlug));

  useEffect(() => {
    setLimits(readLimits(projectSlug));
  }, [projectSlug]);

  useEffect(() => {
    if (!projectSlug.trim() || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(projectSlug), JSON.stringify(limits));
    } catch {
      /* storage is best-effort */
    }
  }, [projectSlug, limits]);

  const setLimit = useCallback((status: string, limit: number | null) => {
    if (!status.trim()) return;
    setLimits((current) => {
      const next = { ...current };
      if (limit === null || !Number.isFinite(limit) || limit <= 0) {
        delete next[status];
      } else {
        next[status] = Math.floor(limit);
      }
      return next;
    });
  }, []);

  return { limits, setLimit };
}
