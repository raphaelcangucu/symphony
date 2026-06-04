import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import {
  fetchEditorTargets,
  type EditorReason,
  type EditorTarget,
  type EditorTargets,
} from "@/services/editor";

const STARTING_POLL_MS = 2_000;

interface UseIssueEditorArgs {
  projectSlug: string;
  identifier: string | null;
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

export function useIssueEditor({ projectSlug, identifier, enabled = true }: UseIssueEditorArgs): UseIssueEditorResult {
  const [browser, setBrowser] = useState(EMPTY_TARGET);
  const [cursorDesktop, setCursorDesktop] = useState(EMPTY_TARGET);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const targets = await fetchEditorTargets(projectSlug, identifier);
      setBrowser(targets.browser);
      setCursorDesktop(targets.cursorDesktop);
    } catch {
      setBrowser({ ...EMPTY_TARGET, reason: "unavailable" });
      setCursorDesktop(EMPTY_TARGET);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

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
      if (focusedRef.current) void refetch();
    }, STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, browser.reason, refetch]);

  useEffect(() => {
    if (!active || browser.reason !== "starting" || !focused) return;
    void refetch();
  }, [active, browser.reason, focused, refetch]);

  return { browser, cursorDesktop, loading };
}
