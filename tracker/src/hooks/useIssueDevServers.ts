import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import {
  fetchIssueDevServers,
  restartIssueDevServer,
  restartIssueDevServers,
  startIssueDevServer,
  startIssueDevServers,
  startPublicTunnel,
  stopIssueDevServer,
  stopIssueDevServers,
  subscribeIssueDevServers,
  type IssueDevServersStreamHandlers,
} from "@/services/issueDevServers";
import {
  fetchThreadDevServers,
  restartThreadDevServer,
  restartThreadDevServers,
  startThreadDevServer,
  startThreadDevServers,
  stopThreadDevServer,
  stopThreadDevServers,
  subscribeThreadDevServers,
} from "@/services/threadDevServers";
import type { IssueDevServersResponse } from "@/types/issue";

export interface UseIssueDevServersResult {
  data: IssueDevServersResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  startServer: (serverId: number) => Promise<void>;
  stopServer: (serverId: number) => Promise<void>;
  restartServer: (serverId: number) => Promise<void>;
  startTunnel: () => Promise<void>;
}

type IssueDevServerAction = () => Promise<IssueDevServersResponse>;

type IssueDevServerInstanceAction = (serverId: number) => Promise<IssueDevServersResponse>;

export function useIssueDevServers(
  projectSlug: string | null | undefined,
  issueIdentifier: string | null | undefined,
  threadId?: number | null,
): UseIssueDevServersResult {
  const [data, setData] = useState<IssueDevServersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const streamFailedRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const hasIdentifiers = hasRequiredIdentifier(projectSlug) && hasRequiredIdentifier(issueIdentifier);
  const validThreadId = Number.isInteger(threadId) && (threadId ?? 0) > 0 ? threadId : null;
  const hasScope = hasIdentifiers || validThreadId != null;

  const refresh = useCallback(async () => {
    if (!hasScope) {
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
      const response =
        validThreadId != null
          ? await fetchThreadDevServers(validThreadId)
          : await fetchIssueDevServers(projectSlug!, issueIdentifier!);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(response);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setError(i18n.t("issue.devServer.errors.loadFailed"));
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [hasScope, issueIdentifier, projectSlug, validThreadId]);

  const runAction = useCallback(
    async (action: IssueDevServerAction, failureMessage: string) => {
      if (!hasScope) {
        setError(i18n.t("issue.devServer.errors.identifiersRequired"));
        return;
      }

      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;
      const actionGeneration = actionGenerationRef.current;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const response = await action();

        if (requestId !== requestIdRef.current) {
          return;
        }

        setData(response);
        setError(null);
        hasLoadedRef.current = true;
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(failureMessage);
      } finally {
        if (actionGeneration === actionGenerationRef.current) {
          actionInFlightRef.current = false;
        }

        if (requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [hasScope],
  );

  const runInstanceAction = useCallback(
    async (action: IssueDevServerInstanceAction, serverId: number, failureMessage: string) => {
      if (!hasScope) {
        setError(i18n.t("issue.devServer.errors.identifiersRequired"));
        return;
      }

      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;
      const actionGeneration = actionGenerationRef.current;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const response = await action(serverId);

        if (requestId !== requestIdRef.current) {
          return;
        }

        setData(response);
        setError(null);
        hasLoadedRef.current = true;
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(failureMessage);
      } finally {
        if (actionGeneration === actionGenerationRef.current) {
          actionInFlightRef.current = false;
        }

        if (requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [hasScope],
  );

  const start = useCallback(
    () =>
      runAction(
        () =>
          validThreadId != null
            ? startThreadDevServers(validThreadId)
            : startIssueDevServers(projectSlug!, issueIdentifier!),
        i18n.t("issue.devServer.errors.startAllFailed"),
      ),
    [issueIdentifier, projectSlug, runAction, validThreadId],
  );
  const stop = useCallback(
    () =>
      runAction(
        () =>
          validThreadId != null
            ? stopThreadDevServers(validThreadId)
            : stopIssueDevServers(projectSlug!, issueIdentifier!),
        i18n.t("issue.devServer.errors.stopAllFailed"),
      ),
    [issueIdentifier, projectSlug, runAction, validThreadId],
  );
  const restart = useCallback(
    () =>
      runAction(
        () =>
          validThreadId != null
            ? restartThreadDevServers(validThreadId)
            : restartIssueDevServers(projectSlug!, issueIdentifier!),
        i18n.t("issue.devServer.errors.restartAllFailed"),
      ),
    [issueIdentifier, projectSlug, runAction, validThreadId],
  );
  const startServer = useCallback(
    (serverId: number) =>
      runInstanceAction(
        (id) =>
          validThreadId != null
            ? startThreadDevServer(validThreadId, id)
            : startIssueDevServer(projectSlug!, issueIdentifier!, id),
        serverId,
        i18n.t("issue.devServer.errors.startFailed"),
      ),
    [issueIdentifier, projectSlug, runInstanceAction, validThreadId],
  );
  const stopServer = useCallback(
    (serverId: number) =>
      runInstanceAction(
        (id) =>
          validThreadId != null
            ? stopThreadDevServer(validThreadId, id)
            : stopIssueDevServer(projectSlug!, issueIdentifier!, id),
        serverId,
        i18n.t("issue.devServer.errors.stopFailed"),
      ),
    [issueIdentifier, projectSlug, runInstanceAction, validThreadId],
  );
  const restartServer = useCallback(
    (serverId: number) =>
      runInstanceAction(
        (id) =>
          validThreadId != null
            ? restartThreadDevServer(validThreadId, id)
            : restartIssueDevServer(projectSlug!, issueIdentifier!, id),
        serverId,
        i18n.t("issue.devServer.errors.restartFailed"),
      ),
    [issueIdentifier, projectSlug, runInstanceAction, validThreadId],
  );

  const startTunnel = useCallback(async () => {
    try {
      const tunnel = await startPublicTunnel();
      setData((current) => (current ? { ...current, tunnel } : current));
      setError(null);
    } catch {
      setError(i18n.t("issue.devServer.errors.tunnelFailed"));
    } finally {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    requestIdRef.current += 1;
    hasLoadedRef.current = false;
    inFlightRef.current = false;
    actionGenerationRef.current += 1;
    actionInFlightRef.current = false;
    streamFailedRef.current = false;

    if (!hasScope) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const handlers: IssueDevServersStreamHandlers = {
      onSnapshot: (response) => {
        setData(response);
        setError(null);
        hasLoadedRef.current = true;
        setLoading(false);
      },
      onUpdate: (response) => {
        setData(response);
        setError(null);
      },
      onError: () => {
        if (streamFailedRef.current) {
          return;
        }

        streamFailedRef.current = true;
        void refresh();
      },
    };

    const unsubscribe =
      validThreadId != null
        ? subscribeThreadDevServers(validThreadId, handlers)
        : subscribeIssueDevServers(projectSlug!, issueIdentifier!, handlers);

    return () => {
      requestIdRef.current += 1;
      inFlightRef.current = false;
      actionGenerationRef.current += 1;
      actionInFlightRef.current = false;
      unsubscribe();
    };
  }, [hasScope, issueIdentifier, projectSlug, refresh, validThreadId]);

  useEffect(() => {
    if (!hasScope || !focused) return;
    void refresh();
  }, [focused, hasScope, refresh]);

  return { data, loading, error, refresh, start, stop, restart, startServer, stopServer, restartServer, startTunnel };
}

function hasRequiredIdentifier(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
