import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "sonner";

import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { Layout } from "@/components/layout/Layout";
import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";
import { ProjectDevEnvRoute } from "@/components/projects/ProjectDevEnvRoute";
import { NewProjectRoute } from "@/components/projects/NewProjectRoute";
import { ProjectFiltersRoute } from "@/components/projects/ProjectFiltersRoute";
import { IssueAssistantRoute } from "@/components/workspace/IssueAssistantRoute";
import { IssueDetailRoute } from "@/components/workspace/IssueDetailRoute";
import { NewIssueRoute } from "@/components/workspace/NewIssueRoute";
import { ProjectAssistantRoute } from "@/components/workspace/ProjectAssistantRoute";
import { ProjectExploreAssistantRoute } from "@/components/workspace/ProjectExploreAssistantRoute";
import { WorkspaceFiltersRoute } from "@/components/workspace/WorkspaceFiltersRoute";
import { getTrackerToken } from "@/config";
import { AssistantPage } from "@/pages/AssistantPage";
import { BoardPage } from "@/pages/BoardPage";
import { ListPage } from "@/pages/ListPage";
import { BackupPage } from "@/pages/BackupPage";
import { ObservabilityPage } from "@/pages/ObservabilityPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { TemplateEditPage } from "@/pages/TemplateEditPage";
import { TemplateListPage } from "@/pages/TemplateListPage";
import { TokenGatePage } from "@/pages/TokenGatePage";

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

function RequireToken({ children }: { children: ReactNode }) {
  return getTrackerToken() ? <>{children}</> : <Navigate to="/token" replace />;
}

function EditToSettingsRedirect() {
  const { projectSlug = "" } = useParams();
  return <Navigate to={`/projects/${projectSlug}/settings`} replace />;
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
              <Route path=":projectSlug/dev-env" element={<ProjectDevEnvRoute />} />
              <Route path=":projectSlug/edit" element={<EditToSettingsRedirect />} />
            </Route>
            <Route path="projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
              <Route index element={<Navigate to="board" replace />} />
              <Route path="board" element={<BoardPage />}>
                <Route path="new-issue" element={<NewIssueRoute />} />
                <Route path="filters" element={<WorkspaceFiltersRoute />} />
                <Route path="issues/:identifier" element={<IssueDetailRoute />} />
                <Route path="issues/:identifier/:tab" element={<IssueDetailRoute />} />
              </Route>
              <Route path="list" element={<ListPage />}>
                <Route path="new-issue" element={<NewIssueRoute />} />
                <Route path="filters" element={<WorkspaceFiltersRoute />} />
                <Route path="issues/:identifier" element={<IssueDetailRoute />} />
                <Route path="issues/:identifier/:tab" element={<IssueDetailRoute />} />
              </Route>
              <Route path="assistant" element={<ProjectAssistantRoute />} />
              <Route path="assistant/explore" element={<ProjectExploreAssistantRoute />} />
              <Route path="assistant/new-issue" element={<IssueAssistantRoute />} />
              <Route path="assistant/issue/:issueId" element={<IssueAssistantRoute />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
              <Route path="settings/:tab" element={<ProjectSettingsPage />} />
            </Route>
            <Route path="templates" element={<TemplateListPage />} />
            <Route path="templates/:slug" element={<TemplateEditPage />} />
            <Route path="observability" element={<ObservabilityPage />} />
            <Route path="backups" element={<BackupPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="assistant/:threadId" element={<AssistantPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
