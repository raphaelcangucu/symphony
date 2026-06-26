import { cn } from "@/lib/utils";

/**
 * Classical-composer bust statue on a plinth — an on-theme "maestro" mark for
 * the Symphony knowledge base assistant. The powdered wig with side curls plus
 * the pedestal read as a composer statue (Mozart/Beethoven) even at small sizes.
 * Drawn as a single-tone silhouette in `currentColor` so it works on any
 * button background.
 */
export function MaestroIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("h-6 w-6", className)}
    >
      {/* Powdered wig crown */}
      <path d="M6.4 9.3c-.5-1.1-.5-2.4.2-3.4C7.5 4.3 9.5 3.2 12 3.2s4.5 1.1 5.4 2.7c.7 1 .7 2.3.2 3.4Z" />
      {/* Face */}
      <ellipse cx="12" cy="9.6" rx="3.5" ry="3.9" />
      {/* Side curls of the wig */}
      <circle cx="6.6" cy="9.4" r="1.7" />
      <circle cx="17.4" cy="9.4" r="1.7" />
      {/* Shoulders of the bust */}
      <path d="M6 17.2c0-2.4 2.7-3.8 6-3.8s6 1.4 6 3.8v.5H6Z" />
      {/* Plinth top slab */}
      <rect x="4.3" y="18.1" width="15.4" height="1.8" rx="0.3" />
      {/* Plinth base */}
      <rect x="6.8" y="20.1" width="10.4" height="2" rx="0.3" />
    </svg>
  );
}
