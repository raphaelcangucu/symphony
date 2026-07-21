import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import {
  fetchEditorTargets,
  fetchThreadEditorTargets,
  type EditorReason,
  type EditorTarget,
  type EditorTargets,
} from "@/services/editor";

const STARTING_POLL_MS = 2_000;
const TARGET_CACHE_TTL_MS = 30_000;

interface UseIssueEditorArgs {
  projectSlug: string;
  identifier?: string | null;
  threadId?: number | null;
  enabled?: boolean;
}

export interface UseIssueEditorResult extends EditorTargets {
  loading: boolean;
}

/**
 * Loads the embedded editor target for an issue once a drawer is open, then
 * lightly re-polls only while the editor is still booting (reason === "starting")
 * so it flips to available without requiring a manual refresh.
 */
const EMPTY_TARGET: EditorTarget = { url: null, available: false, reason: null };

type CacheEntry = { targets: EditorTargets; at: number };

const targetCache = new Map<string, CacheEntry>();

function readCache(key: string): EditorTargets | null {
  const entry = targetCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TARGET_CACHE_TTL_MS) {
    targetCache.delete(key);
    return null;
  }
  return entry.targets;
}

function writeCache(key: string, targets: EditorTargets): void {
  targetCache.set(key, { targets, at: Date.now() });
}

/** @internal test helper */
export function clearIssueEditorTargetCache(): void {
  targetCache.clear();
}

export function useIssueEditor({
  projectSlug,
  identifier,
  threadId,
  enabled = true,
}: UseIssueEditorArgs): UseIssueEditorResult {
  const [browser, setBrowser] = useState(EMPTY_TARGET);
  const [cursorDesktop, setCursorDesktop] = useState(EMPTY_TARGET);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const normalizedIdentifier = identifier?.trim() || null;
  const threadRequested = threadId != null;
  const validThreadId =
    threadRequested && Number.isInteger(threadId) && threadId > 0 ? threadId : null;
  const requestCacheKey = threadRequested
    ? validThreadId
      ? `thread\0${validThreadId}`
      : null
    : normalizedIdentifier && projectSlug
      ? `issue\0${projectSlug}\0${normalizedIdentifier}`
      : null;
  const active = enabled && requestCacheKey !== null;

  const refetch = useCallback(async (opts?: { force?: boolean }) => {
    if (!requestCacheKey || inFlightRef.current) return;

    if (!opts?.force) {
      const cached = readCache(requestCacheKey);
      if (cached) {
        setBrowser(cached.browser);
        setCursorDesktop(cached.cursorDesktop);
        setLoading(false);
        return;
      }
    }

    inFlightRef.current = true;
    setLoading(true);
    try {
      const targets = validThreadId
        ? await fetchThreadEditorTargets(validThreadId)
        : await fetchEditorTargets(projectSlug, normalizedIdentifier!);
      writeCache(requestCacheKey, targets);
      setBrowser(targets.browser);
      setCursorDesktop(targets.cursorDesktop);
    } catch {
      setBrowser({ ...EMPTY_TARGET, reason: "unavailable" as EditorReason });
      setCursorDesktop(EMPTY_TARGET);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [normalizedIdentifier, projectSlug, requestCacheKey, validThreadId]);

  useEffect(() => {
    if (!active) {
      setBrowser(EMPTY_TARGET);
      setCursorDesktop(EMPTY_TARGET);
      setLoading(false);
      return undefined;
    }

    void refetch();
    return undefined;
  }, [active, refetch]);

  useEffect(() => {
    if (!active || browser.reason !== "starting") return undefined;
    const timer = setInterval(() => {
      if (focusedRef.current) void refetch({ force: true });
    }, STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, browser.reason, refetch]);

  useEffect(() => {
    if (!active || browser.reason !== "starting" || !focused) return;
    void refetch({ force: true });
  }, [active, browser.reason, focused, refetch]);

  return { browser, cursorDesktop, loading };
}
