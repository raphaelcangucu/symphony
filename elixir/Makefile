.PHONY: help all setup deps build fmt fmt-check lint test coverage ci dialyzer repo-ci db-create db-migrate tracker-setup tracker-deps tracker-build tracker-lint tracker-test tracker-ci tracker-api tracker-dev

MIX ?= mix
NPM ?= npm
TRACKER_DIR ?= ../tracker
TRACKER_PORT ?= 4000
WORKFLOW ?= ./WORKFLOW.md

help:
	@echo "Targets: setup, deps, build, fmt, fmt-check, lint, test, coverage, dialyzer, ci, all"
	@echo "Tracker: tracker-setup, tracker-deps, tracker-build, tracker-lint, tracker-test, tracker-ci, tracker-api, tracker-dev, repo-ci"
	@echo "Database: db-create, db-migrate"

setup:
	$(MIX) setup

deps:
	$(MIX) deps.get

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

db-create:
	$(MIX) ecto.create

db-migrate:
	$(MIX) ecto.migrate

tracker-setup:
	$(MAKE) setup
	$(MAKE) tracker-deps
	$(MAKE) db-create
	$(MAKE) db-migrate

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

tracker-api:
	$(MAKE) build
	./bin/symphony --port $(TRACKER_PORT) $(WORKFLOW)

tracker-dev:
	$(NPM) --prefix $(TRACKER_DIR) run dev
