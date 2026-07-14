import { Outlet } from "react-router-dom";

import { ProjectSidebar } from "./ProjectSidebar";
import { SidebarMobileDrawer } from "./sidebar/SidebarMobileDrawer";
import { SidebarTreeProvider } from "./sidebar/SidebarTreeContext";

export function Layout() {
  return (
    <SidebarTreeProvider>
      <div className="flex h-screen min-h-0 bg-background text-foreground">
        <ProjectSidebar variant="desktop" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SidebarMobileDrawer />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarTreeProvider>
  );
}
