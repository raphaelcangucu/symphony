import { createContext, useContext, type ReactNode } from "react";

import { useSidebarTree, type UseSidebarTreeResult } from "@/hooks/useSidebarTree";

const SidebarTreeContext = createContext<UseSidebarTreeResult | null>(null);

export interface SidebarTreeProviderProps {
  children: ReactNode;
}

/**
 * Owns the single layout-level `useSidebarTree()` instance so desktop and mobile
 * presentations share one project fetch/cache and preference state.
 */
export function SidebarTreeProvider({ children }: SidebarTreeProviderProps) {
  const value = useSidebarTree();
  return <SidebarTreeContext.Provider value={value}>{children}</SidebarTreeContext.Provider>;
}

export function useSidebarTreeContext(): UseSidebarTreeResult {
  const value = useContext(SidebarTreeContext);
  if (value == null) {
    throw new Error("useSidebarTreeContext must be used within SidebarTreeProvider");
  }
  return value;
}
