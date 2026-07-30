export interface UnifiedComposerStateInput {
  runActive: boolean;
  queueingEnabled: boolean;
  canSteer: boolean;
  pending: boolean;
}

export interface UnifiedComposerState {
  enterIntent: "send" | "queue" | "steer" | "blocked";
  primaryAction: "send" | "stop";
  composerDisabled: boolean;
}

export function deriveUnifiedComposerState(
  input: UnifiedComposerStateInput,
): UnifiedComposerState {
  if (!input.runActive) {
    return {
      enterIntent: "send",
      primaryAction: "send",
      composerDisabled: input.pending,
    };
  }

  if (input.queueingEnabled) {
    return {
      enterIntent: "queue",
      primaryAction: "stop",
      composerDisabled: false,
    };
  }

  return {
    enterIntent: input.canSteer ? "steer" : "blocked",
    primaryAction: "stop",
    composerDisabled: !input.canSteer,
  };
}
