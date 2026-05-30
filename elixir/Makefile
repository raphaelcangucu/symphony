.PHONY: help all setup deps ensure-deps build fmt fmt-check lint test coverage ci dialyzer repo-ci \
	check-tools install-code-server configure-code-server db-create db-migrate migrate migration new-migration rollback \
	serve stop tracker-setup tracker-deps tracker-build tracker-lint tracker-test tracker-ci \
	tracker-api tracker-api-escript tracker-dev

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
# Dev-only default bearer token for the tracker UI/API. Override with a real
# secret via the SYMPHONY_TRACKER_TOKEN environment variable in any real setup.
TRACKER_TOKEN ?= dev-local-token
WORKFLOW ?= ./WORKFLOW.md

help:
	@echo "Quality:  setup, deps, build, fmt, fmt-check, lint, test, coverage, dialyzer, ci, all"
	@echo "Database: migrate (create+migrate), migration (alias), new-migration name=<desc>, rollback, db-create"
	@echo "Run:      serve (recommended local dev server), stop, check-tools"
	@echo "Editor:   install-code-server, configure-code-server (browser VS Code for task workspaces)"
	@echo "Tracker:  tracker-setup, tracker-deps, tracker-build, tracker-lint, tracker-test, tracker-ci, tracker-dev, repo-ci"
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

fmt:
	$(MIX) format

fmt-check:
	$(MIX) format --check-formatted

lint:
	$(MIX) lint

coverage:
	$(MIX) test --cover

test:
	$(MIX) test

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

repo-ci:
	$(MAKE) ci
	$(MAKE) tracker-ci

check-tools:
	@if [ -n "$(strip $(MISE))" ]; then echo "✓ mise detected ($(MISE))"; else echo "… mise not found — using system mix/elixir"; fi
	@$(MIX) --version >/dev/null 2>&1 && echo "✓ mix runnable" || { echo "✗ mix is not runnable; install Elixir/OTP (see README) or run via mise"; exit 1; }
	@command -v code-server >/dev/null 2>&1 && echo "✓ code-server installed ($$(code-server --version 2>&1 | head -1))" || echo "… code-server not installed (optional — run make install-code-server)"

# Installs code-server to ~/.local for the optional browser editor (editor: in WORKFLOW.md).
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

# --- Run -------------------------------------------------------------------

# Recommended local development server. Ensures deps + migrations, then boots
# the full app through Mix (so native NIFs like the SQLite driver load). A
# dev-only tracker token is injected unless SYMPHONY_TRACKER_TOKEN is already set.
serve: ensure-deps migrate
	@token="$${SYMPHONY_TRACKER_TOKEN:-$(TRACKER_TOKEN)}"; \
	echo "▶ Starting Symphony tracker"; \
	echo "    URL      : http://localhost:$(TRACKER_PORT)/tracker"; \
	echo "    Workflow : $(WORKFLOW)"; \
	echo "    Token    : $$token  (paste it on the /token page)"; \
	SYMPHONY_TRACKER_TOKEN="$$token" SYMPHONY_TRACKER_PORT="$(TRACKER_PORT)" \
		$(MIX) run --no-start dev/serve.exs "$(WORKFLOW)"

# The bracket in the pattern keeps pkill from matching this recipe's own
# command line (its argv contains the literal `dev/serve[.]exs`, which the
# regex `dev/serve[.]exs` does not match).
stop:
	@pkill -f 'dev/serve[.]exs' >/dev/null 2>&1 && echo "stopped running serve process" || echo "no running serve process found"

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
tracker-api-escript: build migrate
	$(ESCRIPT) --i-understand-that-this-will-be-running-without-the-usual-guardrails --port $(TRACKER_PORT) $(WORKFLOW)

tracker-dev:
	$(NPM) --prefix $(TRACKER_DIR) run dev
