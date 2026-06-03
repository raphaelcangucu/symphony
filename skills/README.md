# Project skills

Single canonical home for all agent skills in this repo. Each skill is a
directory with a `SKILL.md` (CLI convention: `<skill>/SKILL.md`).

This folder is reused by both agent CLIs via symlinks, so there is no
duplication and every skill is shared across agents:

- `.codex/skills` → `../skills`
- `.claude/skills` → `../skills`

## Layout

- `superpowers/` — agent-agnostic software-development methodology skills
  vendored from https://github.com/obra/superpowers (static vendor; update
  manually). Includes the full set: `brainstorming`, `writing-plans`,
  `test-driven-development`, `systematic-debugging`, `requesting-code-review`,
  `receiving-code-review`, `subagent-driven-development`,
  `dispatching-parallel-agents`, `executing-plans`, `using-git-worktrees`,
  `finishing-a-development-branch`, `verification-before-completion`,
  `writing-skills`, and `using-superpowers`. Each skill keeps its upstream
  companion files (reference docs, prompts, scripts).

  `SymphonyElixir.Skills` reads `skills/superpowers/<name>/SKILL.md` and injects
  `brainstorming` + `writing-plans` into the issue authoring assistant in
  complex mode. The `brainstorming`/`writing-plans` `SKILL.md` files are
  intentionally adapted for Symphony injection and may differ slightly from
  upstream. Because these live one level deeper, repo-local CLI auto-discovery
  does not surface them directly from this canonical tree.
- `commit/`, `debug/`, `github-projects/`, `land/`, `linear/`, `pull/`,
  `push/` — operational workflow skills (git, PRs, tracker).
- `release/` — release workflow skill.

## Workspace discovery

When Symphony creates or opens an issue workspace, it prepares a generated flat
skill mirror at `.symphony/skills/`. That mirror links both top-level project
skills and vendored `superpowers/<name>` skills as `skills/<name>/SKILL.md`,
which is the layout Codex and Claude Code expect for native discovery.

Symphony then links `.codex/skills` and `.claude/skills` to that generated
mirror in the workspace root. For browser VS Code multi-root workspaces, it
also adds those links inside direct editor roots such as `front/`, `repo/`,
`back/`, and `docs/` when they exist.

These generated links are workspace-local runtime artifacts. They should not be
edited by hand; update the canonical files in this `skills/` directory instead.

## Notes

- The `.codex/skills` and `.claude/skills` symlinks are relative, so they work
  after a fresh clone on systems with symlink support (Linux/macOS/WSL).
- Add a new shared skill by creating `skills/<name>/SKILL.md`; it becomes
  available to both CLIs automatically through the symlinks.
