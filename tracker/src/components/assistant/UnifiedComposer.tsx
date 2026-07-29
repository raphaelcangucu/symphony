import { Square } from "lucide-react";

import {
  AssistantComposer,
  type AssistantComposerProps,
  type AssistantComposerSubmit,
} from "@/components/assistant/AssistantComposer";
import { ComposerAddMenu } from "@/components/assistant/ComposerAddMenu";
import {
  type ComposerActionContext,
  type ComposerActionHandlers,
} from "@/components/assistant/composerActions";
import { ComposerPermissionMenu } from "@/components/assistant/ComposerPermissionMenu";
import { deriveUnifiedComposerState } from "@/components/assistant/unifiedComposerState";
import { Button } from "@/components/ui/button";
import type { ComposerPermissionOption } from "@/lib/composerCapabilities";
import type { ComposerPermissionLevel } from "@/types/assistant-thread";

export interface UnifiedComposerProps
  extends Omit<
    AssistantComposerProps,
    "addMenu" | "onSubmit" | "submitActions" | "toolbarBeforeAgent"
  > {
  runActive: boolean;
  pending: boolean;
  queueingEnabled: boolean;
  canSteer: boolean;
  permission: ComposerPermissionLevel;
  permissionOptions: readonly ComposerPermissionOption[];
  actionContext: ComposerActionContext;
  actionHandlers: ComposerActionHandlers;
  onPermissionChange: (permission: ComposerPermissionLevel) => void;
  onSend: (payload: AssistantComposerSubmit) => void;
  onQueue: (payload: AssistantComposerSubmit) => void;
  onSteer: (payload: AssistantComposerSubmit) => void;
  onStop: () => void;
}

export function UnifiedComposer({
  runActive,
  pending,
  queueingEnabled,
  canSteer,
  permission,
  permissionOptions,
  actionContext,
  actionHandlers,
  disabled = false,
  composerDisabled = false,
  onPermissionChange,
  onSend,
  onQueue,
  onSteer,
  onStop,
  ...composerProps
}: UnifiedComposerProps) {
  const state = deriveUnifiedComposerState({
    runActive,
    pending,
    queueingEnabled,
    canSteer,
  });
  const controlsDisabled =
    disabled || composerDisabled || state.composerDisabled;

  const handleSubmit = (payload: AssistantComposerSubmit) => {
    if (state.enterIntent === "queue") {
      onQueue(payload);
    } else if (state.enterIntent === "steer") {
      onSteer(payload);
    } else if (state.enterIntent === "send") {
      onSend(payload);
    }
  };

  return (
    <AssistantComposer
      {...composerProps}
      disabled={disabled}
      composerDisabled={controlsDisabled}
      onSubmit={handleSubmit}
      addMenu={(openFilePicker) => (
        <ComposerAddMenu
          context={actionContext}
          handlers={{ ...actionHandlers, files: openFilePicker }}
          disabled={controlsDisabled}
        />
      )}
      toolbarBeforeAgent={
        <ComposerPermissionMenu
          value={permission}
          options={permissionOptions}
          disabled={controlsDisabled}
          onChange={onPermissionChange}
        />
      }
      submitActions={
        state.primaryAction === "stop" ? (
          <Button
            type="button"
            variant="default"
            size="icon"
            className="h-8 w-8 rounded-full"
            disabled={disabled || pending}
            aria-label="Stop execution"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : undefined
      }
    />
  );
}
