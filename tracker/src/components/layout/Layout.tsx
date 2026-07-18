import { Outlet } from "react-router-dom";

import { FloatingSurfaceHost } from "@/components/floating/FloatingSurfaceHost";
import { MaestroExtraContextProvider } from "@/components/maestro/MaestroExtraContext";
import { MaestroHost } from "@/components/maestro/MaestroHost";
import { AgentExecutionsProvider } from "@/hooks/AgentExecutionsProvider";
import { RecentsProvider } from "@/hooks/RecentsProvider";

import { ProjectSidebar } from "./ProjectSidebar";
import { SidebarMobileDrawer } from "./sidebar/SidebarMobileDrawer";
import { SidebarTreeProvider } from "./sidebar/SidebarTreeContext";

export function Layout() {
  return (
    <AgentExecutionsProvider>
      <RecentsProvider>
        <SidebarTreeProvider>
          <MaestroExtraContextProvider>
            <div className="flex h-screen min-h-0 overflow-hidden bg-background text-foreground">
              <ProjectSidebar variant="desktop" />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <SidebarMobileDrawer />
                <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <Outlet />
                </main>
              </div>
            </div>
            <FloatingSurfaceHost />
            <MaestroHost />
          </MaestroExtraContextProvider>
        </SidebarTreeProvider>
      </RecentsProvider>
    </AgentExecutionsProvider>
  );
}
