import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { listIssueDocuments } from "@/services/issueDocuments";
import type { IssueDocument } from "@/types/issueDocument";

const DEFAULT_INTERVAL_MS = 20_000;

interface UseIssueDocumentsArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
  refreshKey?: number;
  intervalMs?: number;
}

export interface UseIssueDocumentsResult {
  documents: IssueDocument[];
  available: boolean;
  reason: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useIssueDocuments({
  projectSlug,
  identifier,
  enabled = true,
  refreshKey = 0,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseIssueDocumentsArgs): UseIssueDocumentsResult {
  const [documents, setDocuments] = useState<IssueDocument[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const activeResourceKeyRef = useRef<string | null>(null);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Boolean(projectSlug && identifier);
  const activeResourceKey = active ? `${projectSlug}:${identifier}` : null;

  const refetch = useCallback(async () => {
    if (!active || !projectSlug || !identifier) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    const requestId = ++requestIdRef.current;
    inFlightRef.current = true;

    if (!hasLoadedRef.current) {
      setLoading(true);
    }

    try {
      const response = await listIssueDocuments(projectSlug, identifier);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setDocuments(response.documents);
      setAvailable(response.available);
      setReason(response.reason);
      hasLoadedRef.current = true;
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [active, identifier, projectSlug]);

  useEffect(() => {
    requestIdRef.current += 1;
    inFlightRef.current = false;

    if (!active) {
      activeResourceKeyRef.current = null;
      hasLoadedRef.current = false;
      setDocuments([]);
      setAvailable(false);
      setReason(null);
      setLoading(false);
      return undefined;
    }

    if (activeResourceKeyRef.current !== activeResourceKey) {
      activeResourceKeyRef.current = activeResourceKey;
      hasLoadedRef.current = false;
    }

    void refetch();

    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, intervalMs);

    return () => {
      clearInterval(timer);
      requestIdRef.current += 1;
      inFlightRef.current = false;
    };
  }, [active, activeResourceKey, intervalMs, refetch, refreshKey]);

  useEffect(() => {
    if (!active || !focused) {
      return;
    }

    void refetch();
  }, [active, focused, refetch]);

  return { documents, available, reason, loading, refetch };
}
