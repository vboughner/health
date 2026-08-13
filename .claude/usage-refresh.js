#!/usr/bin/env node
'use strict';

// Background worker: fetches usage limits from Anthropic API and caches them.
// Spawned detached by statusline.js when the cache is stale (>2 min).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const CACHE_PATH = path.join(os.homedir(), '.claude', '.usage-cache.json');
const LOCK_PATH = path.join(os.homedir(), '.claude', '.usage-refresh.lock');

function getAccessToken() {
  if (process.platform === 'darwin') {
    const cred = execFileSync('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ], { encoding: 'utf8', timeout: 5000 }).trim();
    const parsed = JSON.parse(cred);
    return parsed?.claudeAiOauth?.accessToken || '';
  }
  // Linux: secret-tool
  const cred = execFileSync('secret-tool', [
    'lookup', 'service', 'Claude Code-credentials',
  ], { encoding: 'utf8', timeout: 5000 }).trim();
  const parsed = JSON.parse(cred);
  return parsed?.claudeAiOauth?.accessToken || '';
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  try {
    fs.writeFileSync(LOCK_PATH, `${process.pid}`, { mode: 0o600 });
    const token = getAccessToken();
    if (!token) {
      try { fs.writeFileSync(CACHE_PATH, '{}', { mode: 0o600 }); } catch {}
      return;
    }

    const body = await fetchUsage(token);
    const data = JSON.parse(body);
    if (!data.five_hour) {
      try { fs.writeFileSync(CACHE_PATH, '{}', { mode: 0o600 }); } catch {}
      return;
    }

    fs.writeFileSync(CACHE_PATH, JSON.stringify(data) + '\n', { mode: 0o600 });
  } catch {
    // Touch the cache so we don't retry immediately
    try {
      if (fs.existsSync(CACHE_PATH)) {
        fs.utimesSync(CACHE_PATH, new Date(), new Date());
      } else {
        fs.writeFileSync(CACHE_PATH, '{}', { mode: 0o600 });
      }
    } catch {}
  } finally {
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  }
})();
