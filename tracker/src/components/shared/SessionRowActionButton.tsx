import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SessionRowActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Shared ghost icon button used for per-row session actions (archive, resume,
 * …). Keeps every list-row control visually identical: same size, muted
 * foreground, and click isolation so the button never triggers the parent
 * link/card. Callers supply the icon and an accessible label.
 */
export function SessionRowActionButton({
  label,
  onClick,
  disabled = false,
  className,
  children,
}: SessionRowActionButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("h-5 w-5 shrink-0 text-muted-foreground", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}
