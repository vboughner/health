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

```sh
ssh griljor@5.78.75.71
git clone https://github.com/vboughner/health.git ~/health
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
cd ~/health/server && npm run create-user -- van
```

### 8. Nightly backup

The database and the recordings are two files in two places, so the backup covers
both — see `scripts/backup.sh`. A `.backup` of `app.db` alone would look complete
and quietly lose every recording.

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
| Food search returns only saved foods | `USDA_API_KEY` missing from `~/health-data/.env`, or PM2 started before the file existed (`pm2 restart health --update-env`) |
| App on the phone shows an old version | Stale service worker — nginx must send `no-cache` for `/index.html` and `/sw.js` |
