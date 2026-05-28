import { Outlet } from "react-router-dom";

import { ProjectSidebar } from "./ProjectSidebar";

export function Layout() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <ProjectSidebar />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
