import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { statusToneBadgeClass, type StatusTone } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";

const statusPillVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", {
  variants: {
    size: {
      default: "text-[11px]",
      sm: "text-[10px]",
      md: "text-xs",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  /** Semantic tone driving border/background/text colors. */
  tone: StatusTone;
}

/**
 * Rounded status pill driven by semantic tones. Single primitive behind the
 * session/evidence/KB status badges so status colors stay consistent.
 */
export function StatusPill({ tone, size, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ size }), statusToneBadgeClass(tone), className)} {...props}>
      {children}
    </span>
  );
}

export { statusPillVariants };
