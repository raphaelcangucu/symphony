export const TRACKER_PROJECTS_CHANGED_EVENT = "symphony-tracker-projects-changed";
export const TRACKER_PROJECT_SESSIONS_CHANGED_EVENT =
  "symphony-tracker-project-sessions-changed";

export function notifyTrackerProjectsChanged() {
  window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
}

export function notifyTrackerProjectSessionsChanged(projectSlug: string) {
  const slug = projectSlug.trim();
  if (!slug) return;
  window.dispatchEvent(
    new CustomEvent(TRACKER_PROJECT_SESSIONS_CHANGED_EVENT, {
      detail: { projectSlug: slug },
    }),
  );
}
