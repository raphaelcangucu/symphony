import * as React from "react";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      xs: "h-3 w-3",
      sm: "h-3.5 w-3.5",
      md: "h-4 w-4",
      lg: "h-5 w-5",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement>, VariantProps<typeof spinnerVariants> {}

/** Shared loading spinner. Replaces ad-hoc `Loader2 + animate-spin` usages. */
export function Spinner({ size, className, ...props }: SpinnerProps) {
  return <Loader2 aria-hidden="true" className={cn(spinnerVariants({ size }), className)} {...props} />;
}
