# Project explore default workspace

**Date:** 2026-07-16  
**Status:** approved for implementation  
**Surface:** Elixir `ProjectExploreWorkspace`, inventory `:project` entry, `AgentSession` project_session turns

## Problem

Exploratory `project_session` threads for projects with a custom `workspace.root`
(e.g. advising → `~/code/advising-workspaces`) are pinned to the **global**
explore path (`Config.workspace_root()/slug`). Turns then fail
`PathOwnership.validate` because that path is outside the project layout.
The failure is surfaced as a misleading Goal Mode error.

Separately, inventory omits `kind: :project` when the segment root has no
cloned repos, so “Explorar projeto” cannot preselect the project default
workspace.

## Goals

1. `ProjectExploreWorkspace.path/ensure` use `Workspace.project_layout/1`
   (segment root under the project’s `workspace.root`).
2. Inventory always emits a `:project` entry for an existing segment root,
   even with zero repos.
3. Creating / running a session on that default path provisions repo clones
   via `ProjectExploreWorkspace.ensure/2`.
4. A targeted integration test covers custom `workspace.root` + explore turn.

## Non-goals

- Migrating existing threads that already store the wrong global path
  (open a new explore session).
- Changing issue_session or standalone workspace semantics.
- Rewording the Goal Mode error string (follow-up).
