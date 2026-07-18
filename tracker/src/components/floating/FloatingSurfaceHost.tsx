import { useFloatingSurfaces } from "@/hooks/useFloatingSurfaces";

import { FloatingSurfaceContent } from "./FloatingSurfaceContent";
import { FloatingSurfaceWindow } from "./FloatingSurfaceWindow";

export function FloatingSurfaceHost() {
  const surfaces = useFloatingSurfaces();
  if (surfaces.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" data-testid="floating-surface-host">
      {surfaces.map((surface) => (
        <div key={surface.id} className="pointer-events-auto">
          <FloatingSurfaceWindow surface={surface}>
            <FloatingSurfaceContent surface={surface} />
          </FloatingSurfaceWindow>
        </div>
      ))}
    </div>
  );
}
