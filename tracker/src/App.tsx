import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "sonner";

import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Layout } from "@/components/layout/Layout";
import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";
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
import { KbGeneralPage } from "@/pages/KbGeneralPage";
import { KbProjectPage } from "@/pages/KbProjectPage";
import { BackupPage } from "@/pages/BackupPage";
import { ObservabilityPage } from "@/pages/ObservabilityPage";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TemplateListPage } from "@/pages/TemplateListPage";
import { TemplateEditPage } from "@/pages/TemplateEditPage";
import { TokenGatePage } from "@/pages/TokenGatePage";
import { settingsTemplatesPath } from "@/lib/settingsRoutes";

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

function RequireToken({ children }: { children: ReactNode }) {
  return getTrackerToken() ? <>{children}</> : <Navigate to="/token" replace />;
}

function EditToSettingsRedirect() {
  const { projectSlug = "" } = useParams();
  return <Navigate to={`/projects/${projectSlug}/settings`} replace />;
}

function LegacyTemplateRedirect() {
  const { slug = "" } = useParams();
  return <Navigate to={settingsTemplatesPath(slug || undefined)} replace />;
}

export function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <I18nProvider>
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
                <Route path="kb/*" element={<KbProjectPage />} />
              </Route>
              <Route path="templates" element={<Navigate to="/settings/templates" replace />} />
              <Route path="templates/:slug" element={<LegacyTemplateRedirect />} />
              <Route path="observability" element={<ObservabilityPage />} />
              <Route path="backups" element={<Navigate to="/settings/backups" replace />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<SettingsPage />} />
                <Route path="templates" element={<TemplateListPage />} />
                <Route path="templates/:slug" element={<TemplateEditPage />} />
                <Route path="backups" element={<BackupPage />} />
              </Route>
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="assistant/:threadId" element={<AssistantPage />} />
              <Route path="kb/*" element={<KbGeneralPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
        <Toaster position="bottom-right" richColors />
      </I18nProvider>
    </BrowserRouter>
  );
}
