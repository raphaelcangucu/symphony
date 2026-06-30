import { useEffect, useRef } from "react";

import {
  type ExecutionShortcutId,
  matchShortcut,
} from "@/lib/executionShortcuts";

export interface ExecutionShortcutHandlers {
  onResume?: () => void;
  onRestart?: () => void;
  onStop?: () => void;
  onHardReset?: () => void;
  onCycleMode?: () => void;
  onFocusComposer?: () => void;
  onMagicOpen?: () => void;
  /** Disable all shortcuts (e.g. while a dispatch is in flight). Defaults to enabled. */
  enabled?: boolean;
}

const HANDLER_BY_ID: Record<ExecutionShortcutId, keyof ExecutionShortcutHandlers> = {
  resume: "onResume",
  restart: "onRestart",
  stop: "onStop",
  hardReset: "onHardReset",
  cycleMode: "onCycleMode",
  focusComposer: "onFocusComposer",
  magicOpen: "onMagicOpen",
};

// Non-destructive shortcuts allowed to fire while the operator is typing in the
// composer; destructive actions (restart/hardReset) require focus outside inputs.
const ALLOWED_INSIDE_INPUT = new Set<ExecutionShortcutId>([
  "resume",
  "stop",
  "cycleMode",
  "focusComposer",
]);

function isInsideInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || Boolean(element?.isContentEditable);
}

export function useExecutionShortcuts(handlers: ExecutionShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const current = handlersRef.current;
      if (current.enabled === false) return;

      const id = matchShortcut(event);
      if (!id) return;

      if (isInsideInput(event.target) && !ALLOWED_INSIDE_INPUT.has(id)) return;

      const handler = current[HANDLER_BY_ID[id]];
      if (typeof handler !== "function") return;

      event.preventDefault();
      handler();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
