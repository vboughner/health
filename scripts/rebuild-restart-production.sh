#!/usr/bin/env bash
#
# scripts/rebuild-restart-production.sh
#
# Run this on the VPS to rebuild and restart the app.
#
# BEFORE running this script, pull the latest code:
#   cd ~/health && git pull
#   bash ~/health/scripts/rebuild-restart-production.sh
#
# IMPORTANT NOTES (both learned the hard way on the griljor deploy):
#
#   - Do NOT touch the nginx config. The live file at
#     /etc/nginx/sites-available/health has certbot SSL lines that are not in
#     the repo. Copying a repo template over it would wipe them.
#
#   - web/dist is recreated from scratch by every build and loses the read
#     permission nginx (www-data) needs. The chmod below re-grants it. Skipping
#     it produces a 500 with a permission error in /var/log/nginx/error.log.
#
#   - Database migrations run automatically when the process starts. The
#     database lives outside the repo, so nothing here touches it.

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building server..."
cd "$REPO_DIR/server"
npm install --omit=dev --no-audit --no-fund
npm install --no-audit --no-fund   # devDeps needed for tsc
npm run build

echo "==> Building web..."
cd "$REPO_DIR/web"
npm install --no-audit --no-fund
npm run build

echo "==> Fixing permissions on web/dist (required for nginx/www-data)..."
chmod -R o+r "$REPO_DIR/web/dist"
find "$REPO_DIR/web/dist" -type d -exec chmod o+x {} +

echo "==> Restarting PM2 process..."
cd "$REPO_DIR/server"
pm2 restart health --update-env

echo ""
echo "Done. Verify with:"
echo "  pm2 status                                        # 'health' should be online"
echo "  pm2 logs health --lines 30                        # migrations + listen line"
echo "  curl -I https://health.hovercloud.com             # 200 over TLS"
echo "  curl -i https://health.hovercloud.com/api/auth/me # 401 when logged out"
