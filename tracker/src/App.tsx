import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { Layout } from "@/components/layout/Layout";
import { getTrackerToken } from "@/config";
import { ProjectBoardPage } from "@/pages/ProjectBoardPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { TemplateEditPage } from "@/pages/TemplateEditPage";
import { TemplateListPage } from "@/pages/TemplateListPage";
import { TokenGatePage } from "@/pages/TokenGatePage";

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

function RequireToken({ children }: { children: ReactNode }) {
  return getTrackerToken() ? <>{children}</> : <Navigate to="/token" replace />;
}

export function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <Routes>
        <Route path="/token" element={<TokenGatePage />} />
        <Route
          element={
            <RequireToken>
              <ViewerProvider>
                <Outlet />
              </ViewerProvider>
            </RequireToken>
          }
        >
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectListPage />} />
            <Route path="projects/:projectSlug/board" element={<ProjectBoardPage />} />
            <Route path="projects/:projectSlug/list" element={<ProjectListPage />} />
            <Route path="templates" element={<TemplateListPage />} />
            <Route path="templates/:slug" element={<TemplateEditPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
