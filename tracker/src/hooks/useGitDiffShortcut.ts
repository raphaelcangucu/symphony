import { useEffect } from "react";

interface UseGitDiffShortcutOptions {
  enabled?: boolean;
}

export function useGitDiffShortcut(onOpen: () => void, options: UseGitDiffShortcutOptions = {}): void {
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "g") return;
      if (isTextEntryTarget(event.target)) return;

      event.preventDefault();
      onOpen();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onOpen]);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}
