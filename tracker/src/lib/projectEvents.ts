export const TRACKER_PROJECTS_CHANGED_EVENT = "symphony-tracker-projects-changed";

export function notifyTrackerProjectsChanged() {
  window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
}
