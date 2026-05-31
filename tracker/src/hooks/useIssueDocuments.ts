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

interface LatestRequestState {
  active: boolean;
  projectSlug: string;
  identifier: string | null;
  resourceKey: string | null;
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
  const queuedRefetchRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const activeResourceKeyRef = useRef<string | null>(null);
  const latestRequestRef = useRef<LatestRequestState>({
    active: false,
    projectSlug: "",
    identifier: null,
    resourceKey: null,
  });
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  const previousFocusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Boolean(projectSlug && identifier);
  const activeResourceKey = active ? `${projectSlug}:${identifier}` : null;
  latestRequestRef.current = { active, projectSlug, identifier, resourceKey: activeResourceKey };

  const refetch = useCallback(async () => {
    const requestState = latestRequestRef.current;

    if (!requestState.active || !requestState.projectSlug || !requestState.identifier) {
      return;
    }

    if (inFlightRef.current) {
      queuedRefetchRef.current = true;
      return;
    }

    const requestVersion = requestVersionRef.current;
    const requestResourceKey = requestState.resourceKey;
    inFlightRef.current = true;

    if (!hasLoadedRef.current) {
      setLoading(true);
    }

    try {
      const response = await listIssueDocuments(requestState.projectSlug, requestState.identifier);
      const latestRequestState = latestRequestRef.current;

      if (
        requestVersion !== requestVersionRef.current ||
        !latestRequestState.active ||
        latestRequestState.resourceKey !== requestResourceKey
      ) {
        return;
      }

      setDocuments(response.documents);
      setAvailable(response.available);
      setReason(response.reason);
      hasLoadedRef.current = true;
    } catch {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
    } finally {
      inFlightRef.current = false;

      if (queuedRefetchRef.current && latestRequestRef.current.active) {
        queuedRefetchRef.current = false;
        void refetch();
        return;
      }

      queuedRefetchRef.current = false;

      if (requestVersion === requestVersionRef.current || !latestRequestRef.current.active) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    requestVersionRef.current += 1;

    if (!active) {
      activeResourceKeyRef.current = null;
      hasLoadedRef.current = false;
      queuedRefetchRef.current = false;
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
      requestVersionRef.current += 1;
    };
  }, [active, activeResourceKey, intervalMs, refetch, refreshKey]);

  useEffect(() => {
    const wasFocused = previousFocusedRef.current;
    previousFocusedRef.current = focused;

    if (!active || !focused || wasFocused) {
      return;
    }

    void refetch();
  }, [active, focused, refetch]);

  return { documents, available, reason, loading, refetch };
}
