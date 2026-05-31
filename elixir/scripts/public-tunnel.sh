#!/usr/bin/env bash

# Run the Cloudflare named tunnel exposing *.tracker.cods.dev -> 127.0.0.1:4000.
# The Phoenix hub (PublicHostPlug) routes preview hosts to dev-server ports.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is required but was not found in PATH" >&2
    exit 1
fi

env_value() {
    local key="$1" default_value="$2" value=""
    if [ -f ".env" ]; then
        value="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- | tr -d '"'\''' || true)"
    fi
    echo "${value:-$default_value}"
}

TUNNEL_NAME="$(env_value CLOUDFLARED_TUNNEL_NAME cods-dev-tunnel)"
ROUTE_DNS="$(env_value PUBLIC_TUNNEL_ROUTE_DNS false)"
TUNNEL_CONFIG="$(env_value PUBLIC_TUNNEL_CONFIG /tmp/symphony-cods-dev-tunnel.yml)"

# The Phoenix hub always listens on :4000; the ingress is a static wildcard.
cat > "$TUNNEL_CONFIG" <<EOF
tunnel: ${TUNNEL_NAME}
ingress:
  - hostname: "*.tracker.cods.dev"
    service: http://127.0.0.1:4000
  - service: http_status:404
EOF

if [ "$ROUTE_DNS" != "false" ]; then
    echo "Ensuring Cloudflare CNAMEs via mix symphony.tunnel.dns..."
    mix symphony.tunnel.dns
fi

echo "Starting Cloudflare tunnel ${TUNNEL_NAME} (config: ${TUNNEL_CONFIG})..."
exec cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME"
