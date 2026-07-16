import { useTranslation } from "react-i18next";

import { MaestroIcon } from "@/components/kb/MaestroIcon";
import { cn } from "@/lib/utils";

interface MaestroLauncherProps {
  running: boolean;
  onClick: () => void;
}

/**
 * Floating launcher pinned bottom-right that opens the docked Maestro. While a
 * turn is running it turns green with an "online" pulse so the user knows the
 * maestro is working even with the panel closed.
 */
export function MaestroLauncher({ running, onClick }: MaestroLauncherProps) {
  const { t } = useTranslation();
  const label = running ? t("maestro.launcher.working") : t("maestro.launcher.open");

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1 transition-all hover:scale-105 active:scale-95",
        running
          ? "bg-emerald-500 text-white ring-emerald-300/60 hover:bg-emerald-600"
          : "bg-primary text-primary-foreground ring-black/5 hover:bg-primary/90",
      )}
    >
      <MaestroIcon className="h-8 w-8" />
      {running ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-background bg-emerald-400" />
        </span>
      ) : null}
    </button>
  );
}
