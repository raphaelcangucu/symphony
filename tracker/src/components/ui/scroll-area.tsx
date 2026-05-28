import * as React from "react";

import { cn, SCROLLBAR_THIN } from "@/lib/utils";

const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("overflow-auto", SCROLLBAR_THIN, className)} {...props} />,
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
