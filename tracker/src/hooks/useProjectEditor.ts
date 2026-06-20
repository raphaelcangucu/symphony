import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { fetchProjectEditorTargets, type EditorTarget, type EditorTargets } from "@/services/editor";

const STARTING_POLL_MS = 2_000;
const EMPTY_TARGET: EditorTarget = { url: null, available: false, reason: null };

interface UseProjectEditorArgs {
  projectSlug: string;
  enabled?: boolean;
}

export interface UseProjectEditorResult extends EditorTargets {
  loading: boolean;
}

export function useProjectEditor({ projectSlug, enabled = true }: UseProjectEditorArgs): UseProjectEditorResult {
  const [browser, setBrowser] = useState(EMPTY_TARGET);
  const [cursorDesktop, setCursorDesktop] = useState(EMPTY_TARGET);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Boolean(projectSlug.trim());

  const refetch = useCallback(async () => {
    if (!projectSlug.trim() || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const targets = await fetchProjectEditorTargets(projectSlug);
      setBrowser(targets.browser);
      setCursorDesktop(targets.cursorDesktop);
    } catch {
      setBrowser({ ...EMPTY_TARGET, reason: "unavailable" });
      setCursorDesktop(EMPTY_TARGET);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [projectSlug]);

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

  const shouldPoll = browser.reason === "starting" || browser.reason === "workspace_missing";

  useEffect(() => {
    if (!active || !shouldPoll) return undefined;
    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, shouldPoll, refetch]);

  useEffect(() => {
    if (!active || !shouldPoll || !focused) return;
    void refetch();
  }, [active, shouldPoll, focused, refetch]);

  return { browser, cursorDesktop, loading };
}
