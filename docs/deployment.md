# Deployment

Target: `health.hovercloud.com` on the existing Hetzner VPS (`5.78.75.71`), alongside
the Griljor game and the blog. Full VPS background lives in
`~/dev/griljor/docs/vps-infrastructure-guide.md`.

This app is the first thing on that VPS with a real database. Everything here is
additive — no existing nginx block, PM2 process, or port changes.

| | |
|---|---|
| Port | **4300** — deliberately out of the 3xxx range: griljor holds 3000–3007 on the VPS, and each local griljor worktree claims the next 3N00 (3100, 3200, …) |
| PM2 app | `health` |
| Repo on VPS | `/home/griljor/health` |
| Database | `/home/griljor/health-data/app.db` — **outside the repo** |
| Secrets | `/home/griljor/health-data/.env` — never committed |
| Static root | `/home/griljor/health/web/dist` |

## First-time setup

### 1. DNS

Cloudflare → `hovercloud.com` → DNS → add:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `health` | `5.78.75.71` | **DNS only (grey cloud)** |

The existing `hovercloud-redirect` nginx block matches only `hovercloud.com` and
`www.hovercloud.com`, so a new subdomain block won't collide with it.

Verify: `dig @1.1.1.1 health.hovercloud.com +short`

### 2. Clone and build

The VPS came with node, npm, pm2, git, gh and certbot from the griljor setup, but not
with a C++ toolchain or the `sqlite3` CLI. Both are needed here:

```sh
sudo apt-get update && sudo apt-get install -y build-essential sqlite3
```

`better-sqlite3` publishes no prebuilt binary for node 24 on linux/x64, so `npm install`
falls back to compiling it with node-gyp — which fails with a bare `not found: make` on
a box that has never built a native module. `sqlite3` is for the nightly backup in
step 8; the app itself never needs it, since it talks to the database through
`better-sqlite3`.

> Because that module is compiled against node 24's ABI, upgrading node on this VPS
> means running `npm rebuild better-sqlite3` (or a fresh `npm install`) afterwards, or
> the app won't start — it fails with a `NODE_MODULE_VERSION` mismatch, not with
> anything that mentions node.

**The repo is private**, so an HTTPS clone has nothing to authenticate with. Use a
read-only deploy key rather than `gh auth login`: it is scoped to this one repo, cannot
push, and keeps working for `git pull` on every future update with no token to expire.
On the VPS:

```sh
ssh-keygen -t ed25519 -C "griljor-vps-health" -f ~/.ssh/id_ed25519_health -N ""
cat >> ~/.ssh/config <<'EOF'

Host github.com
    IdentityFile ~/.ssh/id_ed25519_health
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/id_ed25519_health.pub
```

Add that public key at GitHub → the `health` repo → Settings → Deploy keys, **without**
write access (or `gh repo deploy-key add key.pub --title griljor-vps -R vboughner/health`
from the Mac). Then:

```sh
git clone git@github.com:vboughner/health.git ~/health
mkdir -p ~/health-data/backups

cd ~/health/server && npm install && npm run build
cd ~/health/web    && npm install && npm run build
```

### 3. Secrets

```sh
cat > ~/health-data/.env <<EOF
DB_PATH=/home/griljor/health-data/app.db
MEDIA_DIR=/home/griljor/health-data/audio
SESSION_SECRET=$(openssl rand -hex 32)
USDA_API_KEY=<your key>
PORT=4300
NODE_ENV=production
EOF
chmod 600 ~/health-data/.env
```

### 4. nginx

Worth doing step 6 before this one: start the app under PM2 and confirm
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4300/api/auth/me` returns 401.
That separates "the app doesn't run" from "the proxy is wrong", which otherwise both
present as a 502 once nginx is in front.

Create `/etc/nginx/sites-available/health` (HTTP only — certbot adds the SSL lines itself):

```nginx
server {
    server_name health.hovercloud.com;

    root /home/griljor/health/web/dist;
    index index.html;

    # SPA: unknown paths fall through to the app shell.
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A goals recording is posted as the request body. nginx's default cap is 1m,
        # which a two-minute reading clears and a longer one does not — and the failure
        # arrives as an nginx 413 the app never sees. Kept a little above the server's
        # own 10 MB limit so the app's error message is the one that gets shown.
        client_max_body_size 12m;
    }

    # Never cache the shell or the service worker — otherwise a deploy
    # can leave a stale app installed on the phone.
    location = /index.html { add_header Cache-Control "no-cache"; }
    location = /sw.js      { add_header Cache-Control "no-cache"; }

    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    listen 80;
}
```

nginx runs as `www-data` and needs traversal + read access:

```sh
sudo ln -s /etc/nginx/sites-available/health /etc/nginx/sites-enabled/health
chmod o+x /home/griljor /home/griljor/health /home/griljor/health/web
chmod -R o+r /home/griljor/health/web/dist
sudo nginx -t && sudo systemctl reload nginx
```

### 5. HTTPS

```sh
sudo certbot --nginx -d health.hovercloud.com
```

> **After this point, never copy a config from the repo over
> `/etc/nginx/sites-available/health`.** Certbot rewrote the live file to add SSL and the
> HTTP→HTTPS redirect. Make targeted edits in place instead.

### 6. Start under PM2

```sh
cd ~/health/server
pm2 start ecosystem.config.js
pm2 save
```

`pm2 startup` is already configured on this VPS from the griljor setup, so `pm2 save` is
enough for the app to come back after a reboot.

### 7. Create your login

```sh
cd ~/health/server && ENV_FILE=/home/griljor/health-data/.env npm run create-user -- van
```

**`ENV_FILE` is not optional here.** PM2 passes it to the server process; nothing
passes it to a shell. Without it `config.ts` falls back to `<repo>/.env`, which does
not exist on the VPS, and `DB_PATH` then defaults to `./data/app.db` *relative to the
repo* — so the script creates a second database at `~/health/data/app.db`, migrates it,
writes the account into it, and reports success. Logging in then fails against a
database that has no users, and the stray file is outside everything
`scripts/backup.sh` covers. This happened on the first deploy.

The script prints the database path before prompting for a password. It should read
`/home/griljor/health-data/app.db`; anything else, stop. The same applies to any other
script run by hand against production — `seed-demo` included, whose
`NODE_ENV=production` guard only fires when the env file is actually loaded.

### 8. Nightly backup

The database and the recordings are two files in two places, so the backup covers
both — see `scripts/backup.sh`. A `.backup` of `app.db` alone would look complete
and quietly lose every recording.

`scripts/backup.sh` shells out to the `sqlite3` CLI, which nothing else on this VPS
installs and which the app itself never needs — the server talks to the database
through `better-sqlite3`, a compiled Node module rather than the command-line tool.
Step 2 installs it.

```sh
crontab -e
```

```
0 3 * * * /home/griljor/health/scripts/backup.sh >> /home/griljor/health-data/backup.log 2>&1
```

Keeps 14 days of each. Check it after the first night — this is the first thing on
this VPS with a real database, and the data exists nowhere else:

```sh
ls -la ~/health-data/backups
tail ~/health-data/backup.log
```

## Updating

```sh
ssh griljor@5.78.75.71
cd ~/health && git pull
bash ~/health/scripts/rebuild-restart-production.sh
```

The script rebuilds both packages, re-applies the `chmod` on the freshly recreated
`web/dist`, and restarts the PM2 process. Migrations run automatically at startup.

## Adding a login

There is no signup page, on purpose — the public app has nothing to sign up against, so
every account is made by hand on the VPS:

```sh
ssh griljor@5.78.75.71
cd ~/health/server && ENV_FILE=/home/griljor/health-data/.env npm run create-user -- <username>
```

It prompts for the password twice with echo off, minimum 8 characters, and refuses a
username that already exists. **Check the `Database:` line it prints first** — it must
read `/home/griljor/health-data/app.db`. Anything else and `ENV_FILE` was dropped; see
step 7 for what goes wrong then.

No restart is needed. The server reads users per request, so a new account can log in
immediately.

Every table carries `user_id` and every query filters on it, so a second account is
properly isolated rather than sharing Van's data. Nothing else is per-user, though:
tracked-features settings live in each device's `localStorage`, and the calorie budget
and eating window are columns on `users` with defaults from the mid-2026 plan, which a
new account inherits and nothing in the UI edits.

To list who exists, or remove someone:

```sh
sqlite3 ~/health-data/app.db "SELECT id, username, datetime(created_at/1000,'unixepoch','localtime') FROM users;"
sqlite3 ~/health-data/app.db "PRAGMA foreign_keys = ON; DELETE FROM users WHERE username='<username>';"
```

That `PRAGMA` is not optional — the `sqlite3` CLI has foreign keys **off** by default,
so without it the delete leaves every food, log and daily entry belonging to that user
stranded in the tables instead of cascading. The app sets the pragma at startup, which
is why the cascade looks reliable right up until the first time you clean up by hand.
Their recordings are files and are never covered by the cascade:

```sh
rm -f ~/health-data/audio/goals-<id>-*
```

## Verifying

```sh
pm2 status                                    # 'health' should be online
pm2 logs health --lines 50                    # look for the migration + listen lines
curl -I https://health.hovercloud.com         # 200, valid TLS
curl -i https://health.hovercloud.com/api/auth/me   # 401 when not logged in
sudo certbot certificates                     # should now list health.hovercloud.com
```

Then log in from the phone **on cell data**, not just wifi — that catches DNS or cert
problems a LAN test would hide.

## Troubleshooting

| Symptom | Check |
|---|---|
| 500 on the site | `sudo tail -20 /var/log/nginx/error.log` — usually the `chmod` on `web/dist` after a rebuild |
| 404 on a deep link, works from the home page | `try_files ... /index.html` missing from the nginx block |
| Logged out on every request | Cookie `secure` flag set while serving over HTTP, or `NODE_ENV` not `production` |
| The account you just created can't log in | `create-user` ran without `ENV_FILE` and wrote to a second database. `ls -l ~/health/data/app.db` — if that exists at all it is the stray one. Re-run step 7 with `ENV_FILE=`, then `rm -rf ~/health/data` |
| Food search returns only saved foods | `USDA_API_KEY` missing from `~/health-data/.env`, or PM2 started before the file existed (`pm2 restart health --update-env`) |
| App on the phone shows an old version | Stale service worker — nginx must send `no-cache` for `/index.html` and `/sw.js` |
