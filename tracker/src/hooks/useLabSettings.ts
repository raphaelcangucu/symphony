import { useEffect, useState } from "react";

import { fetchSettings, type LabSettings } from "@/services/settings";

const DEFAULT_LAB: LabSettings = { bundle_child_orchestration: false };

/**
 * Loads instance Lab settings (e.g. bundle child orchestration flag).
 * Defaults to unified mode (flag off) until the fetch completes.
 */
export function useLabSettings(enabled = true): LabSettings {
  const [lab, setLab] = useState<LabSettings>(DEFAULT_LAB);

  useEffect(() => {
    if (!enabled) {
      setLab(DEFAULT_LAB);
      return undefined;
    }

    let cancelled = false;

    void fetchSettings()
      .then((settings) => {
        if (!cancelled) setLab(settings.lab ?? DEFAULT_LAB);
      })
      .catch(() => {
        if (!cancelled) setLab(DEFAULT_LAB);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return lab;
}
