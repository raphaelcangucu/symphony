import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { fetchEditorTarget, type EditorReason } from "@/services/editor";

const STARTING_POLL_MS = 2_000;

interface UseIssueEditorArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueEditorResult {
  url: string | null;
  available: boolean;
  reason: EditorReason | null;
  loading: boolean;
}

/**
 * Loads the embedded editor target for an issue once a drawer is open, then
 * lightly re-polls only while the editor is still booting (reason === "starting")
 * so it flips to available without requiring a manual refresh.
 */
export function useIssueEditor({ projectSlug, identifier, enabled = true }: UseIssueEditorArgs): UseIssueEditorResult {
  const [url, setUrl] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<EditorReason | null>(null);
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
      const target = await fetchEditorTarget(projectSlug, identifier);
      setUrl(target.url);
      setAvailable(target.available);
      setReason(target.reason);
    } catch {
      setUrl(null);
      setAvailable(false);
      setReason("unavailable");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) {
      setUrl(null);
      setAvailable(false);
      setReason(null);
      setLoading(false);
      return undefined;
    }

    void refetch();
    return undefined;
  }, [active, refetch]);

  useEffect(() => {
    if (!active || reason !== "starting") return undefined;
    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [active, reason, refetch]);

  useEffect(() => {
    if (!active || reason !== "starting" || !focused) return;
    void refetch();
  }, [active, reason, focused, refetch]);

  return { url, available, reason, loading };
}
