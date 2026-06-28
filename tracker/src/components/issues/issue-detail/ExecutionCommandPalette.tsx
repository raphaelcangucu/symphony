import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import { Eraser, Pause, PenLine, Play, Repeat, RotateCcw, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { EXECUTION_SHORTCUTS, type ExecutionShortcutId } from "@/lib/executionShortcuts";

interface ExecutionCommandPaletteProps {
  onResume?: () => void;
  onRestart?: () => void;
  onStop?: () => void;
  onHardReset?: () => void;
  onCycleMode?: () => void;
  onFocusComposer?: () => void;
  /** When true, the palette still opens but actions are inert (dispatch in flight). */
  disabled?: boolean;
}

const ICONS: Record<ExecutionShortcutId, LucideIcon> = {
  resume: Play,
  restart: RotateCcw,
  stop: Pause,
  hardReset: Eraser,
  cycleMode: Repeat,
  focusComposer: PenLine,
};

const KEY_GLYPHS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  enter: "↵",
  backspace: "⌫",
};

function formatKeys(keys: string): string {
  return keys
    .split("+")
    .map((part) => KEY_GLYPHS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join("");
}

export function ExecutionCommandPalette({
  onResume,
  onRestart,
  onStop,
  onHardReset,
  onCycleMode,
  onFocusComposer,
  disabled = false,
}: ExecutionCommandPaletteProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handlers: Record<ExecutionShortcutId, (() => void) | undefined> = {
    resume: onResume,
    restart: onRestart,
    stop: onStop,
    hardReset: onHardReset,
    cycleMode: onCycleMode,
    focusComposer: onFocusComposer,
  };

  function runAction(id: ExecutionShortcutId) {
    setOpen(false);
    if (disabled) return;
    handlers[id]?.();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder={t("issue.agent.shortcuts.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("issue.agent.shortcuts.empty")}</CommandEmpty>
          <CommandGroup heading={t("issue.agent.shortcuts.title")}>
            {EXECUTION_SHORTCUTS.map((shortcut) => {
              if (!handlers[shortcut.id]) return null;
              const Icon = ICONS[shortcut.id];
              const label = t(shortcut.labelKey);

              return (
                <CommandItem key={shortcut.id} value={label} onSelect={() => runAction(shortcut.id)}>
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>{label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatKeys(shortcut.keys)}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
