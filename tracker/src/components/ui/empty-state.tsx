import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const emptyStateVariants = cva("flex flex-col items-center border border-dashed text-center", {
  variants: {
    variant: {
      simple: "gap-2 rounded-lg p-6 text-sm text-muted-foreground",
      panel:
        "h-full min-h-0 justify-center rounded-2xl border-border/70 bg-card/60 px-6 py-10 shadow-sm backdrop-blur-sm",
    },
  },
  defaultVariants: {
    variant: "simple",
  },
});

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  icon?: React.ReactNode;
}

/**
 * Shared empty-state container. `simple` renders the compact dashed box used
 * in tabs; `panel` renders the full-height rich panel used by viewers.
 */
export function EmptyState({ variant, icon, className, children, ...props }: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ variant }), className)} {...props}>
      {icon ?? null}
      {children}
    </div>
  );
}
