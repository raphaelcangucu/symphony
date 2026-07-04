export type ExecutionShortcutId =
  | "resume"
  | "stop"
  | "hardReset"
  | "cycleMode"
  | "focusComposer"
  | "magicOpen";

export interface ExecutionShortcut {
  id: ExecutionShortcutId;
  /** Human-editable descriptor, e.g. `mod+shift+r` (`mod` = ⌘ on macOS, Ctrl elsewhere). */
  keys: string;
  labelKey: string;
}

export const EXECUTION_SHORTCUTS: readonly ExecutionShortcut[] = [
  { id: "resume", keys: "mod+enter", labelKey: "issue.agent.shortcuts.resume" },
  { id: "stop", keys: "mod+.", labelKey: "issue.agent.shortcuts.stop" },
  { id: "hardReset", keys: "mod+shift+backspace", labelKey: "issue.agent.shortcuts.hardReset" },
  { id: "cycleMode", keys: "mod+shift+m", labelKey: "issue.agent.shortcuts.cycleMode" },
  { id: "focusComposer", keys: "mod+i", labelKey: "issue.agent.shortcuts.focusComposer" },
  { id: "magicOpen", keys: "mod+p", labelKey: "commands.magic.open" },
] as const;

export interface KeyEventLike {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface Descriptor {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseDescriptor(descriptor: string): Descriptor {
  const parts = descriptor.toLowerCase().split("+");
  return {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key: parts[parts.length - 1] ?? "",
  };
}

export function matchShortcut(event: KeyEventLike): ExecutionShortcutId | null {
  const flags: Descriptor = {
    mod: Boolean(event.metaKey || event.ctrlKey),
    shift: Boolean(event.shiftKey),
    alt: Boolean(event.altKey),
    key: (event.key ?? "").toLowerCase(),
  };

  const match = EXECUTION_SHORTCUTS.find((shortcut) => {
    const descriptor = parseDescriptor(shortcut.keys);
    return (
      descriptor.mod === flags.mod &&
      descriptor.shift === flags.shift &&
      descriptor.alt === flags.alt &&
      descriptor.key === flags.key
    );
  });

  return match ? match.id : null;
}
