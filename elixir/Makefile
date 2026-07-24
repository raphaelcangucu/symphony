.PHONY: help all setup deps ensure-deps build fmt fmt-check lint test coverage ci dialyzer repo-ci release release-smoke daemon-install daemon-status \
	check-tools env-setup install-code-server configure-code-server db-create db-migrate migrate migration new-migration rollback \
	backup backup-list backup-stats backup-cleanup serve update stop tracker-setup tracker-deps tracker-build tracker-lint tracker-test tracker-ci \
	tracker-api tracker-api-escript tracker-dev project-import project-export

# Prefer mise when available so targets work whether or not the shell has mise
# activated. Override any of these on the command line (e.g. `make MIX=mix ...`).
MISE := $(shell command -v mise 2>/dev/null)
ifeq ($(strip $(MISE)),)
MIX ?= mix
ELIXIR ?= elixir
ESCRIPT ?= ./bin/symphony
else
MIX ?= mise exec -- mix
ELIXIR ?= mise exec -- elixir
ESCRIPT ?= mise exec -- ./bin/symphony
endif

NPM ?= npm
TRACKER_DIR ?= ../tracker
TRACKER_PORT ?= 4000
TRACKER_PREVIEW_PORT ?= 4001
TRACKER_VITE_PORT ?= 5174

help:
	@echo "Quality:  setup, deps, build, fmt, fmt-check, lint, test, coverage, dialyzer, ci, all"
	@echo "Database: migrate (create+migrate), migration (alias), new-migration name=<desc>, rollback, db-create"
	@echo "Backup:   backup (create SQLite snapshot), backup-list, backup-stats, backup-cleanup"
	@echo "Run:      serve (boot daemon), update (restart web by default; ARGS=--orchestrator/--code-server/--all), stop, check-tools, env-setup"
	@echo "Daemon:   release, release-smoke, daemon-install, daemon-status"
	@echo "Editor:   install-code-server, configure-code-server (browser VS Code for task workspaces)"
	@echo "Tracker:  tracker-setup, tracker-deps, tracker-build, tracker-lint, tracker-test, tracker-ci, tracker-dev, preview-serve, preview-tracker-dev, repo-ci"
	@echo "Project:  project-export SLUG=name [FILE=out.yaml], project-import FILE=path.yaml [INTO=slug]"
	@echo "Packaged: tracker-api (alias of serve), tracker-api-escript (raw escript; no SQLite NIF)"

# --- Quality / build -------------------------------------------------------

setup:
	$(MIX) setup

deps:
	$(MIX) deps.get

# Fetch deps only when missing, so start-up targets stay fast and offline-friendly.
ensure-deps:
	@test -d deps && test -d _build/$${MIX_ENV:-dev}/lib/symphony_elixir || $(MIX) deps.get

build:
	$(MIX) build
	@printf '#!/usr/bin/env bash\nexec "$$(dirname "$$0")/symphony" claude-app-server "$$@"\n' > bin/symphony-claude
	@chmod +x bin/symphony-claude

fmt:
	$(MIX) format

fmt-check:
	$(MIX) format --check-formatted

lint:
	$(MIX) lint

# Tests source `.env.testing` (blank secrets / no public tunnel) so a developer's
# sourced `.env` does not leak real values into MIX_ENV=test and break
# environment-dependent tests. Pass extra args via ARGS (e.g. `make test ARGS="--seed 0"`).
ENV_TESTING ?= .env.testing

coverage:
	@set -a; [ -f $(ENV_TESTING) ] && . ./$(ENV_TESTING); set +a; $(MIX) test --cover $(ARGS)

test:
	@set -a; [ -f $(ENV_TESTING) ] && . ./$(ENV_TESTING); set +a; $(MIX) test $(ARGS)

dialyzer:
	$(MIX) deps.get
	$(MIX) dialyzer --format short

ci:
	$(MAKE) setup
	$(MAKE) build
	$(MAKE) fmt-check
	$(MAKE) lint
	$(MAKE) coverage
	$(MAKE) dialyzer

all: ci

release: tracker-build
	MIX_ENV=prod SYMPHONY_BUILD_COMMIT="$$(git rev-parse HEAD)" ERL_FLAGS="$${ERL_FLAGS:-+S 4:4}" \
		$(MIX) compile --force
	MIX_ENV=prod SYMPHONY_BUILD_COMMIT="$$(git rev-parse HEAD)" ERL_FLAGS="$${ERL_FLAGS:-+S 4:4}" \
		$(MIX) release symphony --overwrite
	@set -eu; \
		source="$$(find _build/prod -maxdepth 1 -type f -name 'symphony-*.tar.gz' ! -name '*-linux-*' -print -quit)"; \
		test -n "$$source"; \
		target="$${source%.tar.gz}-linux-$$(uname -m).tar.gz"; \
		mv -f "$$source" "$$target"; \
		echo "Release artifact: $$target"

release-smoke: release
	ERL_FLAGS="$${ERL_FLAGS:-+S 4:4}" $(MIX) test test/symphony_elixir/daemon/release_smoke_test.exs

daemon-install: release
	@artifact="$$(find _build/prod -maxdepth 1 -type f -name "symphony-*-linux-$$(uname -m).tar.gz" -print -quit)"; \
	test -n "$$artifact"; \
	$(MIX) symphony.daemon install \
		--artifact "$$artifact" \
		$(ARGS)

daemon-status:
	$(MIX) symphony.daemon status $(ARGS)

repo-ci:
	$(MAKE) ci
	$(MAKE) tracker-ci

check-tools:
	@if [ -n "$(strip $(MISE))" ]; then echo "✓ mise detected ($(MISE))"; else echo "… mise not found — using system mix/elixir"; fi
	@$(MIX) --version >/dev/null 2>&1 && echo "✓ mix runnable" || { echo "✗ mix is not runnable; install Elixir/OTP (see README) or run via mise"; exit 1; }
	@command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && echo "✓ gh authenticated ($$(gh --version | head -1))" || echo "✗ gh missing or not authenticated (required — run: gh auth login)"
	@command -v code-server >/dev/null 2>&1 && echo "✓ code-server installed ($$(code-server --version 2>&1 | head -1))" || echo "… code-server not installed (optional — needed when SYMPHONY_EDITOR_ENABLED=true; run make install-code-server)"
	@command -v cloudflared >/dev/null 2>&1 && echo "✓ cloudflared installed ($$(cloudflared --version 2>&1 | head -1))" || echo "… cloudflared not installed (optional — needed for make tunnel / public preview tunnel)"

# Create/update elixir/.env: fresh SYMPHONY_TRACKER_TOKEN + GITHUB_TOKEN from `gh auth token`.
env-setup:
	@bash scripts/setup-env.sh

# Installs code-server to ~/.local for the optional browser editor (SYMPHONY_EDITOR_ENABLED=true).
# Re-run with FORCE=1 to reinstall the latest release.
install-code-server:
	@bash scripts/install-code-server.sh

# Installs Codex + Claude Code extensions and disables GitHub Copilot in code-server settings.
configure-code-server:
	@bash scripts/configure-code-server-extensions.sh

# --- Database / migrations -------------------------------------------------

db-create:
	$(MIX) ecto.create

# `migrate` is idempotent: it creates the database if needed, then applies all
# pending migrations. Safe to run repeatedly.
migrate:
	$(MIX) ecto.create
	$(MIX) ecto.migrate

# Convenience alias so `make migration` does the obvious thing (apply migrations).
migration: migrate

# Generate a new migration file: `make new-migration name=add_widgets_table`
new-migration:
	@test -n "$(name)" || { echo "Usage: make new-migration name=<snake_case_description>"; exit 1; }
	$(MIX) ecto.gen.migration $(name)

rollback:
	$(MIX) ecto.rollback

# Back-compat alias.
db-migrate: migrate

# --- SQLite backups (tracker DB) -------------------------------------------

backup:
	@set -a; [ -f .env ] && . ./.env; set +a; $(MIX) symphony.backup create $(ARGS)

backup-list:
	@set -a; [ -f .env ] && . ./.env; set +a; $(MIX) symphony.backup list $(ARGS)

backup-stats:
	@set -a; [ -f .env ] && . ./.env; set +a; $(MIX) symphony.backup stats

backup-cleanup:
	@set -a; [ -f .env ] && . ./.env; set +a; $(MIX) symphony.backup cleanup

# --- Run -------------------------------------------------------------------

# Boot/ensure the long-lived Symphony daemon (detached). It owns the DB +
# orchestrator + web + editor, each in its own restartable subtree, so restarting
# one never disturbs the others. Ensures deps + migrations first. Per-project config
# is DB-owned (global-less): no global WORKFLOW is required. Loads elixir/.env for
# host/process settings and secrets (GITHUB_TOKEN, SYMPHONY_TRACKER_TOKEN, node
# name/cookie). Logs: .symphony/serve.log
serve: ensure-deps migrate
	@set -e; \
	if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	SYMPHONY_TRACKER_PORT="$(TRACKER_PORT)" \
		$(MIX) symphony.ctl serve $(ARGS)

# Recompile + restart selected subtree(s) against the running daemon.
# Default: web only (so web edits never kill in-flight orchestrator turns).
# Examples: make update ARGS="--orchestrator" | "--code-server" | "--all"
#
# `migrate` runs first (before the code reload) so a pulled-in migration is
# applied to the live DB; otherwise newly reloaded code can reference a table the
# running database is missing (e.g. tracker_dismissed_pull_requests), 500-ing the
# affected endpoints until the next `make serve`.
update: ensure-deps migrate
	@$(MIX) symphony.ctl update $(ARGS)

# Default: full daemon shutdown. `make stop ARGS="--web"` stops one subtree only.
stop:
	@$(MIX) symphony.ctl stop $(ARGS)

# --- Tracker frontend ------------------------------------------------------

tracker-setup:
	$(MAKE) setup
	$(MAKE) tracker-deps
	$(MAKE) migrate

tracker-deps:
	$(NPM) --prefix $(TRACKER_DIR) ci

tracker-build:
	$(NPM) --prefix $(TRACKER_DIR) run build

tracker-lint:
	$(NPM) --prefix $(TRACKER_DIR) run lint

tracker-test:
	$(NPM) --prefix $(TRACKER_DIR) test

tracker-ci:
	$(MAKE) tracker-deps
	$(MAKE) tracker-lint
	$(MAKE) tracker-test
	$(MAKE) tracker-build

# `tracker-api` now points at the resilient mix-based server. The previous
# escript path lives in `tracker-api-escript`.
tracker-api: serve

# Raw packaged escript. NOTE: the escript does not bundle native NIFs, so the
# SQLite-backed local tracker cannot run from it. Kept for parity / debugging.
# (Legacy: with no positional arg the escript falls back to ./WORKFLOW.md.)
tracker-api-escript: build migrate
	$(ESCRIPT) --i-understand-that-this-will-be-running-without-the-usual-guardrails --port $(TRACKER_PORT)

tracker-dev:
	$(NPM) --prefix $(TRACKER_DIR) run dev

# Isolated preview stack for this worktree: own SQLite DB, HTTP :4001, Vite :5174.
# Does not touch the main repo daemon on :4000 (requires SYMPHONY_SERVE_LOCK_PATH in .env).
preview-serve: ensure-deps migrate
	@set -e; \
	if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	SYMPHONY_TRACKER_PORT="$(TRACKER_PREVIEW_PORT)" \
		$(MIX) symphony.ctl serve $(ARGS)

preview-tracker-dev:
	TRACKER_PORT=$(TRACKER_VITE_PORT) \
	TRACKER_API_PROXY_TARGET=http://127.0.0.1:$(TRACKER_PREVIEW_PORT) \
	TRACKER_SOCKET_PROXY_TARGET=ws://127.0.0.1:$(TRACKER_PREVIEW_PORT) \
	$(NPM) --prefix $(TRACKER_DIR) run dev -- --port $(TRACKER_VITE_PORT) --host 127.0.0.1

# --- Project import/export (CLI) -------------------------------------------

project-import:
	@test -n "$(SOURCE)" || test -n "$(FILE)" || test -n "$(URL)" || { echo "Usage: make project-import FILE=path/to/project.yaml | URL=https://... [INTO=slug]"; exit 1; }
	@set -a; [ -f .env ] && . ./.env; set +a; \
	source="$(URL)"; \
	if [ -z "$$source" ]; then source="$(FILE)"; fi; \
	if [ -z "$$source" ]; then source="$(SOURCE)"; fi; \
	if [ -n "$(INTO)" ]; then \
		$(MIX) symphony.project import "$$source" --into "$(INTO)"; \
	else \
		$(MIX) symphony.project import "$$source"; \
	fi

project-export:
	@test -n "$(SLUG)" || { echo "Usage: make project-export SLUG=project-slug [FILE=out.yaml]"; exit 1; }
	@set -a; [ -f .env ] && . ./.env; set +a; \
	output="$(FILE)"; \
	if [ -z "$$output" ]; then output="../projects/$(SLUG).yaml"; fi; \
	$(MIX) symphony.project export "$(SLUG)" --output "$$output"

project-share:
	@test -n "$(SLUG)" || { echo "Usage: make project-share SLUG=project-slug [GIST_ID=id] [PUBLIC=1]"; exit 1; }
	@set -a; [ -f .env ] && . ./.env; set +a; \
	args=""; \
	if [ -n "$(GIST_ID)" ]; then args="$$args --gist-id $(GIST_ID)"; fi; \
	if [ -n "$(PUBLIC)" ]; then args="$$args --public"; fi; \
	$(MIX) symphony.project share "$(SLUG)" $$args

# --- Public preview tunnel -------------------------------------------------

.PHONY: tunnel tunnel-bg tunnel-logs tunnel-status tunnel-stop tunnel-dns

tunnel: ## Run the Cloudflare tunnel (foreground)
	@exec bash scripts/public-tunnel.sh

tunnel-bg: ## Run the Cloudflare tunnel in the background (logs: /tmp/symphony-cloudflared.log)
	@nohup bash scripts/public-tunnel.sh > /tmp/symphony-cloudflared.log 2>&1 &
	@echo "Tunnel started. Logs: /tmp/symphony-cloudflared.log"

tunnel-logs: ## Tail the background tunnel logs
	@tail -50 /tmp/symphony-cloudflared.log 2>/dev/null || echo "No log file. Is the tunnel running?"

tunnel-status: ## Show the named tunnel status
	@cloudflared tunnel info "$$(grep -E '^CLOUDFLARED_TUNNEL_NAME=' .env | cut -d= -f2 | tr -d '\"' || echo cods-dev-tunnel)" 2>/dev/null || echo "Tunnel not running"

tunnel-stop: ## Stop the background tunnel
	@pkill -f "cloudflared tunnel --config" || true
	@echo "Tunnel stopped."

tunnel-dns: ## Ensure Cloudflare CNAMEs for the namespace
	@mix symphony.tunnel.dns
