import { Outlet } from "react-router-dom";

import { ProjectSidebar } from "./ProjectSidebar";

export function Layout() {
  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <ProjectSidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
