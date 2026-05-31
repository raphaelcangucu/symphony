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
  upstream. Because these live one level deeper, CLI auto-discovery does not
  surface them — they are consumed through Symphony injection.
- `commit/`, `debug/`, `github-projects/`, `land/`, `linear/`, `pull/`,
  `push/` — operational workflow skills (git, PRs, tracker).
- `release/` — release workflow skill.

## Notes

- The `.codex/skills` and `.claude/skills` symlinks are relative, so they work
  after a fresh clone on systems with symlink support (Linux/macOS/WSL).
- Add a new shared skill by creating `skills/<name>/SKILL.md`; it becomes
  available to both CLIs automatically through the symlinks.
