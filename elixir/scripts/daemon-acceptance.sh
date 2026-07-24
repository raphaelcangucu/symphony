#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
elixir_root="$repo_root/elixir"
artifact="$elixir_root/_build/prod/symphony-0.3.0-linux-$(uname -m).tar.gz"
unit="symphony-acceptance-$$.service"
real_home=${HOME:?HOME is required}

if [ "$unit" = "symphony.service" ]; then
  echo "refusing to use the canonical unit" >&2
  exit 2
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "systemd --user is unavailable; log in normally or enable lingering explicitly" >&2
  exit 77
fi

test -f "$artifact"
scratch=$(mktemp -d)
launcher="$scratch/bin/symphony"
export ERL_FLAGS="${ERL_FLAGS:-+S 4:4}"

port=$(
  cd "$elixir_root"
  mise exec -- elixir -e '
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(socket)
    :ok = :gen_tcp.close(socket)
    IO.write(port)
  '
)

cleanup() {
  systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
  rm -f "$real_home/.config/systemd/user/$unit"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT INT TERM

export XDG_DATA_HOME="$scratch/data"
export XDG_STATE_HOME="$scratch/state"
export SYMPHONY_CONFIG_DIR="$scratch/config/symphony"
export SYMPHONY_SYSTEMD_USER_DIR="$real_home/.config/systemd/user"
export SYMPHONY_LAUNCHER_PATH="$launcher"
export SYMPHONY_INSTALL_ROOT="$scratch/lib/symphony"
export SYMPHONY_DAEMON_UNIT="$unit"
export SYMPHONY_LOCAL_TRACKER_DATABASE="$scratch/data/symphony/tracker.sqlite3"
export SYMPHONY_BACKUP_DIR="$scratch/data/symphony/backups"
export SYMPHONY_TRACKER_HOST=127.0.0.1
export SYMPHONY_TRACKER_PORT="$port"
export SYMPHONY_EDITOR_ENABLED=false
export SYMPHONY_CODEX_COMMAND=true

cd "$elixir_root"
mise exec -- mix symphony.daemon install \
  --artifact "$artifact" \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails

"$launcher" daemon status
before=$(systemctl --user show "$unit" --property=NRestarts --value)
systemctl --user kill --kill-whom=all --signal=SIGKILL "$unit"

attempt=0
healthy=false
while [ "$attempt" -lt 120 ]; do
  if "$launcher" daemon status >/dev/null 2>&1; then
    healthy=true
    break
  fi

  attempt=$((attempt + 1))
  sleep 0.25
done

test "$healthy" = true
after=$(systemctl --user show "$unit" --property=NRestarts --value)
test "$after" -gt "$before"
"$launcher" daemon restart
"$launcher" daemon status
"$launcher" daemon uninstall

test -f "$SYMPHONY_LOCAL_TRACKER_DATABASE"
test -f "$SYMPHONY_CONFIG_DIR/symphony.env"
test -d "$SYMPHONY_INSTALL_ROOT/releases"
