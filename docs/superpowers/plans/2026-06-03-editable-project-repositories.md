# Editable project repositories in settings

## Goal

Let users view and edit the repositories linked to a project from the
Project Settings page (Workspace tab). Today repositories are only
selectable in the create wizard (`POST /projects/workspace`) and are never
surfaced or editable afterwards.

Decisions (confirmed with user):

- **Add flow**: full GitHub picker (owner -> repo list), reusing
  `listGitHubOwners` / `listGitHubRepositories`.
- **Save model**: unified with the editor's single "Save configuration"
  button.
- **Remove semantics**: DB-only — removing a repo unlinks it in Symphony,
  no disk/workspace changes.
- **Placement**: Workspace tab, below "Workspace root".

## Data shape

Backend `local_tracker_repositories` row fields:
`github_full_name` (required), `clone_url`, `default_branch`,
`selected_branch`, `local_path`, `workspace_path` (required, relative,
unique per project), `role` (required, free string), `scan_summary`.

Frontend `WorkspaceRepository` (camelCase) already round-trips via
`normalizeRepository` / `repositoryPayload`.

## Backend

1. `Context.replace_repositories/2` — transactional: fetch project, delete
   all its repositories, insert the provided list (reusing
   `repository_attrs` + `Repository.changeset`), broadcast
   `project_updated`. Returns `{:ok, [Repository.t()]}` |
   `{:error, :project_not_found | Ecto.Changeset.t()}`. Empty list allowed.
2. `ProjectController.update_repositories/2` for
   `PUT /projects/:id/repositories` with `%{"repositories" => list}`.
   Validate it's a list, then replace. On success return the full project
   DTO (project + statuses + repositories + setup), matching `update_setup`.
3. Router: `put("/projects/:id/repositories", ProjectController, :update_repositories)`.
4. Tests (`project_repositories_update_test.exs`): replace round-trip;
   missing `github_full_name` -> 422; non-list body -> 422; unknown
   project -> 404.

## Frontend

5. Extract shared helpers into `tracker/src/lib/workspaceRepositories.ts`:
   `sanitizeWorkspaceSegment`, `defaultWorkspacePath`, `inferRole`.
   Re-point the wizard to import them (DRY).
6. `projects.ts`: `updateProjectRepositories(slug, repositories)` ->
   `PUT /projects/:slug/repositories` with
   `{ repositories: repositories.map(repositoryPayload) }`, returns
   normalized `Project`.
7. `config/RepositoriesSection.tsx` — controlled
   (`value: WorkspaceRepository[]`, `onChange`). Per-repo: name label,
   editable `workspacePath`, `role`, `selectedBranch`; remove button.
   "Add repository": owner `<select>` (listGitHubOwners) + repo buttons
   (listGitHubRepositories), dedupe by `fullName`, default
   `workspacePath`/`role`/`selectedBranch` via shared helpers.
8. Wire into `ProjectConfigEditor` Workspace tab: `repositories` state
   seeded from `project.repositories`; render section; in `handleSave`,
   when the repository payload changed, call `updateProjectRepositories`
   before `updateProjectSetup` (setup response is awaited last and already
   includes refreshed repositories).
9. Tests: `RepositoriesSection` (list/edit/remove/add with mocked
   services); `ProjectConfigEditor` save issues the repositories call only
   when repos changed.

## Verification

- `mix test` for the new backend test + Context/controller.
- Frontend: vitest for new/affected files, `tsc -b`, eslint.
