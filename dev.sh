#!/usr/bin/env bash
#
# Start the API server and the web dev server together.
#
#   ./dev.sh          start both, stream logs, Ctrl-C to stop
#
# API:  http://localhost:3200
# Web:  http://localhost:5174  (also on your LAN IP, for testing on the phone)
#
# The web dev server proxies /api to the API server, so the browser talks to a
# single origin and session cookies behave the same as they will behind nginx.

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$REPO_DIR/.env" ]; then
  echo "No .env found. Creating one from .env.example..."
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  # Give it a real session secret so logins survive a restart.
  SECRET=$(openssl rand -hex 32)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" "$REPO_DIR/.env"
  else
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" "$REPO_DIR/.env"
  fi
  echo "Created .env with a generated SESSION_SECRET."
  echo "Add your USDA_API_KEY to it when you have one."
fi

if [ ! -d "$REPO_DIR/server/node_modules" ]; then
  echo "==> Installing server dependencies..."
  npm install --prefix "$REPO_DIR/server"
fi

if [ ! -d "$REPO_DIR/web/node_modules" ]; then
  echo "==> Installing web dependencies..."
  npm install --prefix "$REPO_DIR/web"
fi

cleanup() {
  echo ""
  echo "Stopping..."
  kill 0
}
trap cleanup EXIT INT TERM

echo "==> Starting API on :3200"
npm run dev --prefix "$REPO_DIR/server" &

echo "==> Starting web on :5174"
npm run dev --prefix "$REPO_DIR/web" &

wait
