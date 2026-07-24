#!/bin/sh
set -eu

release_root=$1
scratch=$2
port=$3

mkdir -p "$scratch/home" "$scratch/config" "$scratch/data" "$scratch/state"
export HOME="$scratch/home"
export XDG_CONFIG_HOME="$scratch/config"
export XDG_DATA_HOME="$scratch/data"
export XDG_STATE_HOME="$scratch/state"
export ERL_FLAGS="${ERL_FLAGS:-+S 4:4}"
export SYMPHONY_RUNTIME_MODE=installed
export SYMPHONY_UNGUARDED_ACKNOWLEDGED=true
export SYMPHONY_LOCAL_TRACKER_DATABASE="$scratch/data/symphony/tracker.sqlite3"
export SYMPHONY_BACKUP_DIR="$scratch/data/symphony/backups"
export SYMPHONY_TRACKER_HOST=127.0.0.1
export SYMPHONY_TRACKER_PORT="$port"
export SYMPHONY_BUILD_COMMIT=release-smoke
export SYMPHONY_EDITOR_ENABLED=false

"$release_root/bin/symphony" eval \
  'System.halt(case SymphonyElixir.Daemon.Migration.migrate_release(System.fetch_env!("SYMPHONY_LOCAL_TRACKER_DATABASE")) do :ok -> 0; _ -> 1 end)'

"$release_root/bin/symphony" start >"$scratch/release.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT

attempt=0
while [ "$attempt" -lt 120 ]; do
  if response=$(curl -fsS "http://127.0.0.1:$port/api/health"); then
    printf '%s' "$response" | grep '"mode":"installed"' >/dev/null
    curl -fsS "http://127.0.0.1:$port/dashboard.css" | grep 'font-family' >/dev/null
    curl -fsS "http://127.0.0.1:$port/tracker/" | grep '<div id="root">' >/dev/null
    test -f "$SYMPHONY_LOCAL_TRACKER_DATABASE"
    test -f "$release_root/lib/symphony_elixir-0.3.0/priv/skills/superpowers/using-superpowers/SKILL.md"
    "$release_root/bin/symphony" eval '
      {:ok, db} = Exqlite.Sqlite3.open(System.fetch_env!("SYMPHONY_LOCAL_TRACKER_DATABASE"), mode: :readonly)
      {:ok, statement} = Exqlite.Sqlite3.prepare(db, "SELECT COUNT(*) FROM schema_migrations")
      {:row, [count]} = Exqlite.Sqlite3.step(db, statement)
      :ok = Exqlite.Sqlite3.release(db, statement)
      :ok = Exqlite.Sqlite3.close(db)
      System.halt(if count > 0, do: 0, else: 1)
    '
    exit 0
  fi

  attempt=$((attempt + 1))
  sleep 0.25
done

cat "$scratch/release.log"
exit 1
