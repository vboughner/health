#!/usr/bin/env node
'use strict';

// Self-contained Claude Code status line for the health tracker repo.
//
// Line 1: 🤖 model · 📁 dir · 🔀 branch [git counts]
// Line 2: ctx [bar] N% #W · 5h [bar] N% ↻T · 7d [bar] N% ↻T · ↓in ↑out · cache r:_ w:_ · $cost · ⏱dur (api _) · +A/-R
//
// Ported from the ethos vault's statusline.js (which was trimmed from
// athena/.claude/statusline*.js — the PR/Linear/worktree/plan layers are
// intentionally omitted; this repo merges straight to main, no PRs).
// The 5h/7d usage windows come from the global ~/.claude/.usage-cache.json,
// refreshed in the background by the verbatim usage-refresh.js alongside this file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const USAGE_CACHE_PATH = path.join(os.homedir(), '.claude', '.usage-cache.json');
const USAGE_REFRESH_LOCK = path.join(os.homedir(), '.claude', '.usage-refresh.lock');
const USAGE_CACHE_TTL_MS = 120_000; // 2 minutes

// ── ANSI ──────────────────────────────────────────────────────────────────
const ESC = '\x1b';
const BEL = '\x07';
const RED = `${ESC}[31m`;
const YEL = `${ESC}[33m`;
const GRN = `${ESC}[32m`;
const CYN = `${ESC}[36m`;
const MAG = `${ESC}[35m`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RST = `${ESC}[0m`;
const SEP = ` ${DIM}·${RST} `;

// ── input ─────────────────────────────────────────────────────────────────
function parseInput(json) {
  try {
    const d = JSON.parse(json);
    return {
      model: d?.model?.display_name ?? '?',
      modelId: d?.model?.id ?? '',
      cwd: d?.workspace?.current_dir ?? '',
      projectDir: d?.workspace?.project_dir ?? '',
      pct: Math.floor(d?.context_window?.used_percentage ?? 0),
      inputTokens: d?.context_window?.total_input_tokens ?? 0,
      outputTokens: d?.context_window?.total_output_tokens ?? 0,
      cacheRead: d?.context_window?.current_usage?.cache_read_input_tokens ?? 0,
      cacheWrite: d?.context_window?.current_usage?.cache_creation_input_tokens ?? 0,
      cost: d?.cost?.total_cost_usd ?? 0,
      durationMs: d?.cost?.total_duration_ms ?? 0,
      apiDurationMs: d?.cost?.total_api_duration_ms ?? 0,
      linesAdded: d?.cost?.total_lines_added ?? 0,
      linesRemoved: d?.cost?.total_lines_removed ?? 0,
    };
  } catch {
    return {
      model: '?', modelId: '', cwd: '', projectDir: '', pct: 0,
      inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
      cost: 0, durationMs: 0, apiDurationMs: 0, linesAdded: 0, linesRemoved: 0,
    };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function modelColor(id) {
  if (id.includes('haiku')) return RED;
  if (id.includes('sonnet')) return YEL;
  if (id.includes('opus')) return GRN;
  if (id.includes('fable') || id.includes('mythos')) return MAG;
  return '';
}

function osc8(url, text) {
  if (!url) return text;
  return `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;
}

function buildBar(pct, width, warn, crit) {
  warn = warn ?? 70; crit = crit ?? 90;
  pct = Math.max(0, Math.min(100, Math.floor(pct)));
  const filled = Math.floor(pct * width / 100);
  const color = pct >= crit ? RED : pct >= warn ? YEL : GRN;
  return { bar: color + '█'.repeat(filled) + '░'.repeat(width - filled) + RST, color, pct };
}

function fmtTokens(n) {
  n = Math.floor(n || 0);
  if (n >= 999950) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function fmtDuration(ms) {
  ms = Math.floor(ms || 0);
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms / 60000) % 60);
  const s = Math.floor((ms / 1000) % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function formatResetTime(resetsAt, nowMs) {
  if (!resetsAt) return '?';
  const resetMs = new Date(resetsAt).getTime();
  if (isNaN(resetMs)) return '?';
  let secs = Math.max(0, Math.floor((resetMs - nowMs) / 1000));
  const d = Math.floor(secs / 86400); secs %= 86400;
  const h = Math.floor(secs / 3600); secs %= 3600;
  const m = Math.floor(secs / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function tmpPath(prefix, dir, ext) {
  const hash = crypto.createHash('md5').update(dir || 'default').digest('hex');
  return path.join(os.tmpdir(), `${prefix}${hash}${ext}`);
}

// Context-window counter: increments when the conversation compacts to a new
// window (same heuristic as athena's statusline).
function readWindowCount(inputTokens, projectDir) {
  const wsPath = tmpPath('health-ws-', projectDir, '.state');
  const now = Math.floor(Date.now() / 1000);
  const cur = Math.floor(inputTokens || 0);
  let prevCount = 1, prevPeak = 0, prevEpoch = 0;
  try {
    const parts = fs.readFileSync(wsPath, 'utf8').trim().split(/\s+/);
    prevCount = parseInt(parts[0]) || 1;
    prevPeak = parseInt(parts[1]) || 0;
    prevEpoch = parseInt(parts[2]) || 0;
  } catch {}
  let count, peak;
  if (now - prevEpoch > 300 && cur < 5000) { count = 1; peak = cur; }
  else if (prevPeak > 30000 && cur < prevPeak * 0.4) { count = prevCount + 1; peak = cur; }
  else { count = prevCount; peak = cur > prevPeak ? cur : prevPeak; }
  try { fs.writeFileSync(wsPath, `${count} ${peak} ${now}`); } catch {}
  return count;
}

function readUsageCache() {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_CACHE_PATH, 'utf8'));
    return data && data.five_hour ? data : null;
  } catch { return null; }
}

function gitBranch() {
  try {
    const b = execFileSync('git', ['--no-optional-locks', 'branch', '--show-current'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
    return b || execFileSync('git', ['--no-optional-locks', 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
  } catch { return ''; }
}

function gitCounts() {
  try {
    const text = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
    let staged = 0, modified = 0, untracked = 0;
    for (const line of text.split('\n').filter(Boolean)) {
      if (line.startsWith('??')) { untracked++; continue; }
      if (/^[MADRC]/.test(line)) staged++;
      if (/^.[MD]/.test(line)) modified++;
    }
    return { staged, modified, untracked };
  } catch { return { staged: 0, modified: 0, untracked: 0 }; }
}

function formatGitCounts(c) {
  const parts = [];
  if (c.staged) parts.push(`${GRN}📥${c.staged}${RST}`);
  if (c.modified) parts.push(`${YEL}✏️${c.modified}${RST}`);
  if (c.untracked) parts.push(`${RED}❓${c.untracked}${RST}`);
  return parts.join('');
}

// ── render ────────────────────────────────────────────────────────────────
function render(inputJson) {
  const input = parseInput(inputJson);
  const nowMs = Date.now();

  // Line 1
  const l1 = [];
  l1.push(`🤖 ${modelColor(input.modelId)}${BOLD}${input.model}${RST}`);
  const dir = (input.projectDir || input.cwd || '').split(/[/\\]/).filter(Boolean).pop() || '';
  if (dir) l1.push(`📁 ${osc8('file://' + (input.projectDir || input.cwd), dir)}`);
  const branch = gitBranch();
  if (branch) {
    let seg = `🔀 ${CYN}${branch}${RST}`;
    const gc = formatGitCounts(gitCounts());
    if (gc) seg += ` ${gc}`;
    l1.push(seg);
  }

  // Line 2 — meters
  const ctx = buildBar(input.pct, 10);
  const l2 = [];
  let ctxPart = `${DIM}ctx${RST} [${ctx.bar}] ${ctx.color}${ctx.pct}%${RST}`;
  const w = readWindowCount(input.inputTokens, input.projectDir);
  if (w > 1) ctxPart += ` ${DIM}#${w}${RST}`;
  l2.push(ctxPart);

  const usage = readUsageCache();
  if (usage) {
    const u5 = buildBar(usage.five_hour.utilization || 0, 10, 50, 80);
    const u7 = buildBar((usage.seven_day?.utilization) || 0, 10, 50, 80);
    const t5 = formatResetTime(usage.five_hour.resets_at, nowMs);
    const t7 = formatResetTime(usage.seven_day?.resets_at, nowMs);
    l2.push(`${DIM}5h${RST} [${u5.bar}] ${u5.color}${u5.pct}%${RST} ${DIM}↻${t5}${RST}`);
    l2.push(`${DIM}7d${RST} [${u7.bar}] ${u7.color}${u7.pct}%${RST} ${DIM}↻${t7}${RST}`);
  }

  l2.push(`${GRN}↓${fmtTokens(input.inputTokens)}${RST} ${CYN}↑${fmtTokens(input.outputTokens)}${RST}`);
  l2.push(`${DIM}cache${RST} r:${fmtTokens(input.cacheRead)} w:${fmtTokens(input.cacheWrite)}`);
  l2.push(`${YEL}$${(input.cost || 0).toFixed(2)}${RST}`);
  l2.push(`${DIM}⏱${RST}${fmtDuration(input.durationMs)} ${DIM}(api ${fmtDuration(input.apiDurationMs)})${RST}`);
  l2.push(`${GRN}+${input.linesAdded}${RST}/${RED}-${input.linesRemoved}${RST}`);

  return l1.join(SEP) + '\n' + l2.join(SEP);
}

// ── main ────────────────────────────────────────────────────────────────────
const inputJson = fs.readFileSync(0, 'utf8');
process.stdout.write(render(inputJson) + '\n');

// Background: refresh the global 5h/7d usage cache if stale (account-level,
// shared across all repos). Fully portable — see usage-refresh.js.
try {
  let stale = true;
  try { stale = (Date.now() - fs.statSync(USAGE_CACHE_PATH).mtimeMs) > USAGE_CACHE_TTL_MS; } catch {}
  let lockHeld = false;
  try { lockHeld = (Date.now() - fs.statSync(USAGE_REFRESH_LOCK).mtimeMs) < 30_000; } catch {}
  if (stale && !lockHeld) {
    const child = spawn('node', [path.join(__dirname, 'usage-refresh.js')],
      { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }
} catch {}
