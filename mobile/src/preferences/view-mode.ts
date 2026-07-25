export type MobileViewMode = "orca" | "codex";

export type ViewModeKeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const VIEW_MODE_KEY = "dev10x:mobile:view-mode";

export function createViewModeStorage(storage: ViewModeKeyValueStorage) {
  return {
    async load(): Promise<MobileViewMode> {
      return (await storage.getItem(VIEW_MODE_KEY)) === "codex" ? "codex" : "orca";
    },
    save(mode: MobileViewMode): Promise<void> {
      return storage.setItem(VIEW_MODE_KEY, mode);
    },
  };
}
