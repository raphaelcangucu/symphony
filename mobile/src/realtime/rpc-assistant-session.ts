import type {
  AssistantMessage,
  AssistantTurnPreferences,
  SessionTimelineAction,
} from "@/features/sessions/session-reducer";
import type { HostTransport } from "@/transport/HostTransport";

import { handleAssistantEvent, type AssistantSession } from "./assistant-session";

type CreateRpcAssistantSessionOptions = {
  threadId: number;
  transport: HostTransport;
  seed?: string | null;
  onAction(action: SessionTimelineAction): void;
  onSeedAccepted?(): void;
};

export function createRpcAssistantSession({
  threadId,
  transport,
  seed,
  onAction,
  onSeedAccepted,
}: CreateRpcAssistantSessionOptions): AssistantSession {
  let started = false;
  let connected = false;
  let unsubscribe: (() => void) | null = null;
  let connectionGeneration = 0;
  let seedAccepted = false;
  let seedPromise: Promise<void> | null = null;
  const seedMessageId = `mobile-seed-${threadId}`;

  function connect(): void {
    if (started) return;
    started = true;
    connected = false;
    const generation = ++connectionGeneration;
    onAction({ type: "connection_changed", state: "connecting" });

    void transport
      .subscribe<Record<string, unknown>>(
        "sessions.events",
        { thread_id: threadId },
        (payload, eventName) => {
          if (!started || generation !== connectionGeneration || !eventName) return;
          if (eventName === "sessions.resync_required") {
            void transport
              .call("sessions.command", {
                thread_id: threadId,
                event: "sync_history",
                payload: {},
              })
              .catch((error: unknown) => onAction({ type: "error", message: errorMessage(error) }));
            return;
          }
          handleAssistantEvent(eventName, payload, onAction, reconcileSeed);
        },
      )
      .then((cleanup) => {
        if (!started || generation !== connectionGeneration) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
        connected = true;
        onAction({ type: "connection_changed", state: "live" });
        if (seed?.trim() && !seedAccepted) {
          void sendSeed().catch((error: unknown) =>
            onAction({ type: "error", message: errorMessage(error) }),
          );
        }
      })
      .catch((error: unknown) => {
        if (!started || generation !== connectionGeneration) return;
        connected = false;
        onAction({ type: "connection_changed", state: "offline" });
        onAction({ type: "error", message: errorMessage(error) });
      });
  }

  function disconnect(): void {
    if (!started) return;
    started = false;
    connected = false;
    connectionGeneration += 1;
    unsubscribe?.();
    unsubscribe = null;
    onAction({ type: "connection_changed", state: "offline" });
  }

  function sendMessage(
    message: string,
    contextRefs: Array<{ type: "issue" | "file" | "pr"; id: string }> = [],
  ): Promise<void> {
    const normalized = message.trim();
    if (!normalized) return Promise.reject(new Error("Message is required"));
    return command("send_message", {
      message: normalized,
      ...(contextRefs.length > 0 ? { context_refs: contextRefs } : {}),
    });
  }

  function retrySeed(): Promise<void> {
    return sendSeed();
  }

  function submitApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void> {
    return command("submit_approval", { request_id: requestId, action }).then(() => {
      onAction({ type: "approval_resolved", requestId });
    });
  }

  function submitUserInput(
    requestId: string | number,
    answers: Record<string, string>,
  ): Promise<void> {
    return command("submit_user_input", { request_id: requestId, answers }).then(() => {
      onAction({ type: "user_input_resolved", requestId });
    });
  }

  function stopTurn(): Promise<void> {
    return command("stop_turn", {});
  }

  function resumeTurn(): Promise<void> {
    return command("resume_turn", {});
  }

  function killTool(toolCallId: string): Promise<void> {
    return command("kill_tool", { tool_call_id: toolCallId });
  }

  function setTurnPreferences(preferences: Partial<AssistantTurnPreferences>): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (preferences.executionMode) payload.execution_mode = preferences.executionMode;
    if (preferences.skillProfile !== undefined) payload.skill_profile = preferences.skillProfile;
    if (preferences.model !== undefined) payload.model = preferences.model;
    if (preferences.effort !== undefined) payload.effort = preferences.effort;
    return command("set_turn_preferences", payload);
  }

  function setGoalMode(enabled: boolean, objective?: string): Promise<void> {
    return command("set_goal_mode", {
      goal_mode: enabled,
      ...(enabled && objective?.trim() ? { objective: objective.trim() } : {}),
    });
  }

  function pauseGoal(): Promise<void> {
    return command("goal_pause", {});
  }

  function resumeGoal(): Promise<void> {
    return command("goal_resume", {});
  }

  function clearGoal(): Promise<void> {
    return command("goal_clear", {});
  }

  function setGoalObjective(objective: string): Promise<void> {
    const normalized = objective.trim();
    if (!normalized) return Promise.reject(new Error("Goal objective is required"));
    return command("goal_set_objective", { objective: normalized });
  }

  function command(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!connected) return Promise.reject(new Error("Session is not connected"));
    return transport
      .call("sessions.command", { thread_id: threadId, event, payload })
      .then(() => undefined);
  }

  function sendSeed(): Promise<void> {
    if (seedAccepted) return Promise.resolve();
    if (seedPromise) return seedPromise;
    const message = seed?.trim();
    if (!message) return Promise.resolve();
    seedPromise = command("send_message", {
      message,
      client_message_id: seedMessageId,
    })
      .then(() => acceptSeed())
      .finally(() => {
        seedPromise = null;
      });
    return seedPromise;
  }

  function reconcileSeed(messages: AssistantMessage[]): void {
    const message = seed?.trim();
    if (
      message &&
      messages.some(
        (candidate) => candidate.role === "user" && candidate.content.trim() === message,
      )
    ) {
      acceptSeed();
    }
  }

  function acceptSeed(): void {
    if (seedAccepted) return;
    seedAccepted = true;
    onSeedAccepted?.();
  }

  return {
    connect,
    disconnect,
    retrySeed,
    resumeTurn,
    killTool,
    setTurnPreferences,
    setGoalMode,
    pauseGoal,
    resumeGoal,
    clearGoal,
    setGoalObjective,
    sendMessage,
    stopTurn,
    submitApproval,
    submitUserInput,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Symphony session request failed";
}
