import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { Layout } from "@/components/layout/Layout";
import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";
import { NewProjectRoute } from "@/components/projects/NewProjectRoute";
import { ProjectFiltersRoute } from "@/components/projects/ProjectFiltersRoute";
import { DevEnvRoute } from "@/components/workspace/DevEnvRoute";
import { IssueDetailRoute } from "@/components/workspace/IssueDetailRoute";
import { NewIssueRoute } from "@/components/workspace/NewIssueRoute";
import { WorkspaceFiltersRoute } from "@/components/workspace/WorkspaceFiltersRoute";
import { getTrackerToken } from "@/config";
import { BoardPage } from "@/pages/BoardPage";
import { ListPage } from "@/pages/ListPage";
import { ObservabilityPage } from "@/pages/ObservabilityPage";
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
            <Route path="projects" element={<ProjectListPage />}>
              <Route path="new" element={<NewProjectRoute />} />
              <Route path="filters" element={<ProjectFiltersRoute />} />
            </Route>
            <Route path="projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
              <Route index element={<Navigate to="board" replace />} />
              <Route path="board" element={<BoardPage />}>
                <Route path="new-issue" element={<NewIssueRoute />} />
                <Route path="filters" element={<WorkspaceFiltersRoute />} />
                <Route path="dev-env" element={<DevEnvRoute />} />
                <Route path="issues/:identifier" element={<IssueDetailRoute />} />
                <Route path="issues/:identifier/:tab" element={<IssueDetailRoute />} />
              </Route>
              <Route path="list" element={<ListPage />}>
                <Route path="new-issue" element={<NewIssueRoute />} />
                <Route path="filters" element={<WorkspaceFiltersRoute />} />
                <Route path="issues/:identifier" element={<IssueDetailRoute />} />
                <Route path="issues/:identifier/:tab" element={<IssueDetailRoute />} />
              </Route>
            </Route>
            <Route path="templates" element={<TemplateListPage />} />
            <Route path="templates/:slug" element={<TemplateEditPage />} />
            <Route path="observability" element={<ObservabilityPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
