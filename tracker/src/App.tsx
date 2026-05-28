import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { Layout } from "@/components/layout/Layout";
import { getTrackerToken } from "@/config";
import { ProjectBoardPage } from "@/pages/ProjectBoardPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { TokenGatePage } from "@/pages/TokenGatePage";

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

function RequireToken() {
  return getTrackerToken() ? <Outlet /> : <Navigate to="/token" replace />;
}

export function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <Routes>
        <Route path="/token" element={<TokenGatePage />} />
        <Route element={<RequireToken />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectListPage />} />
            <Route path="projects/:projectSlug/board" element={<ProjectBoardPage />} />
            <Route path="projects/:projectSlug/list" element={<ProjectListPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
