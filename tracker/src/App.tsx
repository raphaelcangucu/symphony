import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster } from "sonner";

import { ViewerProvider } from "@/components/auth/ViewerProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Layout } from "@/components/layout/Layout";
import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";
import { NewProjectRoute } from "@/components/projects/NewProjectRoute";
import { ProjectFiltersRoute } from "@/components/projects/ProjectFiltersRoute";
import { IssueDetailRoute } from "@/components/workspace/IssueDetailRoute";
import { NewIssueRoute } from "@/components/workspace/NewIssueRoute";
import { ProjectAssistantRoute } from "@/components/workspace/ProjectAssistantRoute";
import { ProjectExploreAssistantRoute } from "@/components/workspace/ProjectExploreAssistantRoute";
import { ProjectTerminalRoute } from "@/components/workspace/ProjectTerminalRoute";
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
import { ProjectSessionsPage } from "@/pages/ProjectSessionsPage";
import { ProjectSessionPage } from "@/pages/ProjectSessionPage";
import { ProjectTerminalPage } from "@/pages/ProjectTerminalPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AgentToolSettingsPage } from "@/pages/AgentToolSettingsPage";
import { AppearanceSettingsPage } from "@/pages/AppearanceSettingsPage";
import { ExperimentalSettingsPage } from "@/pages/ExperimentalSettingsPage";
import { ProvidersSettingsPage } from "@/pages/ProvidersSettingsPage";
import { SettingsPlaceholderRoute } from "@/pages/SettingsPlaceholderRoute";
import { SidebarTreeLayoutProposalsPage } from "@/pages/SidebarTreeLayoutProposalsPage";
import { AssistantSessionLayoutProposalsPage } from "@/pages/AssistantSessionLayoutProposalsPage";
import { ToolCallProposalsPage } from "@/pages/ToolCallProposalsPage";
import { WorkspacesPageLayoutProposalsPage } from "@/pages/WorkspacesPageLayoutProposalsPage";
import { WorkspaceArchiveCleanupProposalsPage } from "@/pages/WorkspaceArchiveCleanupProposalsPage";
import { UsageSettingsPage } from "@/pages/UsageSettingsPage";
import { GatewaysSettingsPage } from "@/pages/GatewaysSettingsPage";
import { TemplateListPage } from "@/pages/TemplateListPage";
import { TemplateEditPage } from "@/pages/TemplateEditPage";
import { TokenGatePage } from "@/pages/TokenGatePage";
import { settingsTemplatesPath } from "@/lib/settingsRoutes";
import { projectAuthoringSessionPath, projectNewIssueWorkspacePath } from "@/lib/workspaceRoutes";

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

function LegacySessionsRedirect() {
  const { projectSlug = "", threadId } = useParams();
  const location = useLocation();
  const suffix = threadId ? `/${encodeURIComponent(threadId)}` : "";
  return <Navigate to={`/projects/${projectSlug}/workspaces${suffix}${location.search}`} replace />;
}

function LegacyNewIssueAssistantRedirect() {
  const { projectSlug = "" } = useParams();
  return <Navigate to={projectNewIssueWorkspacePath(projectSlug)} replace />;
}

function LegacyIssueAssistantRedirect() {
  const { projectSlug = "", issueId = "" } = useParams();
  if (!projectSlug.trim() || !issueId.trim()) {
    return <Navigate to="/projects" replace />;
  }
  return <Navigate to={projectAuthoringSessionPath(projectSlug, issueId)} replace />;
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
                <Route path="assistant/terminal" element={<ProjectTerminalRoute />} />
                <Route path="assistant/new-issue" element={<LegacyNewIssueAssistantRedirect />} />
                <Route path="assistant/issue/:issueId" element={<LegacyIssueAssistantRedirect />} />
                <Route path="workspaces" element={<ProjectSessionsPage />} />
                <Route path="workspaces/:threadId" element={<ProjectSessionPage />} />
                {/* Legacy Sessions URLs redirect to the Workspaces page. */}
                <Route path="sessions" element={<LegacySessionsRedirect />} />
                <Route path="sessions/:threadId" element={<LegacySessionsRedirect />} />
                <Route path="terminal" element={<ProjectTerminalPage />} />
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
                <Route path="appearance" element={<AppearanceSettingsPage />} />
                <Route path="keybindings" element={<SettingsPlaceholderRoute section="keybindings" />} />
                <Route path="agents/:agent" element={<AgentToolSettingsPage />} />
                <Route path="tools/:tool" element={<SettingsPlaceholderRoute />} />
                <Route path="providers" element={<ProvidersSettingsPage />} />
                <Route path="web-access" element={<SettingsPlaceholderRoute section="web-access" />} />
                <Route path="mcp" element={<SettingsPlaceholderRoute section="mcp" />} />
                <Route path="integrations" element={<SettingsPlaceholderRoute section="integrations" />} />
                <Route path="usage" element={<UsageSettingsPage />} />
                <Route path="experimental" element={<ExperimentalSettingsPage />} />
                <Route path="templates" element={<TemplateListPage />} />
                <Route path="templates/:slug" element={<TemplateEditPage />} />
                <Route path="backups" element={<BackupPage />} />
                <Route path="gateways" element={<GatewaysSettingsPage />} />
                <Route path="lab" element={<Navigate to="/settings/experimental" replace />} />
              </Route>
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="assistant/:threadId" element={<AssistantPage />} />
              <Route path="kb/*" element={<KbGeneralPage />} />
              <Route
                path="dev/sidebar-tree-proposals"
                element={<SidebarTreeLayoutProposalsPage />}
              />
              <Route
                path="dev/workspaces-page-proposals"
                element={<WorkspacesPageLayoutProposalsPage />}
              />
              <Route
                path="dev/workspace-archive-cleanup-proposals"
                element={<WorkspaceArchiveCleanupProposalsPage />}
              />
              <Route
                path="dev/assistant-session-proposals"
                element={<AssistantSessionLayoutProposalsPage />}
              />
              <Route path="dev/tool-call-proposals" element={<ToolCallProposalsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
        <Toaster position="bottom-right" richColors />
      </I18nProvider>
    </BrowserRouter>
  );
}
