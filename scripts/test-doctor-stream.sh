#!/usr/bin/env bash
# Test the streaming doctor output against a local dev server.
# Usage: bash scripts/test-doctor-stream.sh [--fix]
set -euo pipefail

PORT="${FOOLERY_DEV_PORT:-3211}"
URL="http://localhost:$PORT"

fix=0
for arg in "$@"; do
  case "$arg" in
    --fix) fix=1 ;;
  esac
done

cleanup() {
  local pid
  if [[ -f /tmp/foolery-dev-doctor.pid ]]; then
    pid="$(cat /tmp/foolery-dev-doctor.pid)"
    kill "$pid" 2>/dev/null || true
    rm -f /tmp/foolery-dev-doctor.pid
  fi
}
trap cleanup EXIT

echo "Starting dev server on port $PORT..."
bun run dev --port "$PORT" &>/dev/null &
echo $! > /tmp/foolery-dev-doctor.pid

# Wait for the dev server to be ready
attempts=30
while ((attempts > 0)); do
  if curl -s --max-time 1 "$URL" >/dev/null 2>&1; then
    break
  fi
  attempts=$((attempts - 1))
  sleep 1
done

if ((attempts == 0)); then
  echo "Dev server failed to start on port $PORT" >&2
  exit 1
fi

if [[ "$fix" -eq 0 ]]; then
  echo "Dev server ready. Testing streaming doctor..."
  echo ""

  curl -s --no-buffer "$URL/api/doctor?stream=1" | node /dev/fd/3 3<<'NODE'
const readline = require('node:readline');

const GREEN = '\x1b[0;32m', RED = '\x1b[0;31m', YELLOW = '\x1b[0;33m';
const BOLD = '\x1b[1m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const ICONS = { pass: GREEN + '✔' + RESET, fail: RED + '✘' + RESET, warning: YELLOW + '⚠' + RESET };
const PAD = 24;

process.stdout.write('\n' + BOLD + 'Foolery Doctor' + RESET + '\n\n');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let ev;
  try { ev = JSON.parse(line); } catch { return; }

  if (ev.error) {
    process.stdout.write('  ' + ICONS.fail + '  ' + RED + ev.error + RESET + '\n');
    return;
  }

  if (ev.done) {
    process.stdout.write('\n');
    if (ev.failed > 0 || ev.warned > 0) {
      let s = '  ' + RED + ev.failed + ' failed' + RESET + ', ' + YELLOW + ev.warned + ' warning' + (ev.warned !== 1 ? 's' : '') + RESET + ', ' + GREEN + ev.passed + ' passed' + RESET;
      if (ev.fixable > 0) s += ' (' + ev.fixable + ' auto-fixable — run ' + BOLD + 'foolery doctor --fix' + RESET + ')';
      process.stdout.write(s + '\n');
    } else {
      process.stdout.write('  ' + GREEN + BOLD + 'All clear!' + RESET + ' ' + ev.passed + ' checks passed.\n');
    }
    process.stdout.write('\n');
    return;
  }

  const icon = ICONS[ev.status] || ICONS.pass;
  const label = (ev.label || ev.category || '').padEnd(PAD);
  process.stdout.write('  ' + icon + '  ' + label + DIM + ev.summary + RESET + '\n');

  if (ev.status !== 'pass' && Array.isArray(ev.diagnostics)) {
    for (const d of ev.diagnostics) {
      if (d.severity === 'info') continue;
      const sub = d.severity === 'error' ? ICONS.fail : ICONS.warning;
      process.stdout.write('       ' + sub + '  ' + d.message + '\n');
    }
  }
});
NODE

  exit 0
fi

# ── --fix mode ───────────────────────────────────────────

echo "Dev server ready. Testing doctor --fix..."
echo ""

# Step 1: GET diagnostics
diag_response="$(curl --silent --show-error --max-time 60 "$URL/api/doctor")"

# Step 2: Prompt user per fixable check, collect strategies
strategies_json="$(printf '%s' "$diag_response" | node /dev/fd/3 3<<'NODE'
const fs = require('node:fs');
const readline = require('node:readline');

const raw = fs.readFileSync(0, 'utf8');
let payload;
try { payload = JSON.parse(raw); } catch { process.exit(0); }

const data = payload && typeof payload === 'object' ? (payload.data || {}) : {};
const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
const fixable = diagnostics.filter(d => d && d.fixable);

if (fixable.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

const byCheck = new Map();
for (const d of fixable) {
  const key = d.check || 'unknown';
  if (!byCheck.has(key)) byCheck.set(key, { count: 0, fixOptions: d.fixOptions || [], items: [] });
  const group = byCheck.get(key);
  group.count++;
  group.items.push(d);
}

const BOLD = '\x1b[1m';
const CYAN = '\x1b[0;36m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[0;32m';
const RESET = '\x1b[0m';

const ttyIn = fs.createReadStream('/dev/tty');
const rl = readline.createInterface({ input: ttyIn, output: process.stderr });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

function pickStrategy(options) {
  if (options.length === 0) return 'default';
  return options[0].key;
}

function describeItem(d) {
  const ctx = d.context || {};
  if (ctx.repoName && ctx.file) return ctx.repoName + '/' + ctx.file;
  if (ctx.beadId) return ctx.beadId + (ctx.repoName ? ' in ' + ctx.repoName : '');
  return d.message.slice(0, 80);
}

async function main() {
  const strategies = {};

  for (const [check, info] of byCheck) {
    const options = info.fixOptions;
    const strategy = pickStrategy(options);
    const fixLabel = options.length > 0 ? options[0].label : 'Apply fix';

    process.stderr.write('\n' + BOLD + 'Found ' + info.count + ' fixable issue' + (info.count !== 1 ? 's' : '') + ' for: ' + CYAN + check + RESET + '\n');
    if (options.length > 0) {
      process.stderr.write('  Fix: ' + GREEN + fixLabel + RESET + '\n');
    }

    if (info.count === 1) {
      process.stderr.write('  ' + DIM + describeItem(info.items[0]) + RESET + '\n');
      const ans = await ask('  Apply? [Y/n] ');
      const lower = (ans || '').trim().toLowerCase();
      if (lower === 'n' || lower === 'no') continue;
      strategies[check] = strategy;
    } else {
      process.stderr.write('  [a] Fix all ' + info.count + '\n');
      process.stderr.write('  [i] Choose individually\n');
      process.stderr.write('  [s] Skip\n');
      const ans = await ask('  Choice [a]: ');
      const lower = (ans || '').trim().toLowerCase();

      if (lower === 's' || lower === 'skip') continue;

      if (lower === 'i' || lower === 'individual') {
        const approved = [];
        for (const item of info.items) {
          const label = describeItem(item);
          const itemAns = await ask('    Fix ' + label + '? [Y/n] ');
          const itemLower = (itemAns || '').trim().toLowerCase();
          if (itemLower !== 'n' && itemLower !== 'no') {
            approved.push(item.context || {});
          }
        }
        if (approved.length === 0) continue;
        if (approved.length === info.count) {
          strategies[check] = strategy;
        } else {
          strategies[check] = { strategy: strategy, contexts: approved };
        }
      } else {
        strategies[check] = strategy;
      }
    }
  }

  rl.close();
  ttyIn.destroy();
  process.stdout.write(JSON.stringify(strategies));
}

main().catch(() => { rl.close(); process.exit(1); });
NODE
)"

if [[ -z "$strategies_json" || "$strategies_json" == "{}" ]]; then
  printf '\n  No fixes selected.\n\n'
  exit 0
fi

# Step 3: POST with chosen strategies
post_body="$(printf '{"strategies":%s}' "$strategies_json")"
response="$(curl --silent --show-error --max-time 60 -X POST -H 'Content-Type: application/json' -d "$post_body" "$URL/api/doctor")"

# Step 4: Render fix results
printf '%s' "$response" | node /dev/fd/3 3<<'NODE'
const fs = require('node:fs');

const raw = fs.readFileSync(0, 'utf8');
let payload;
try { payload = JSON.parse(raw); } catch {
  process.stdout.write(raw + (raw.endsWith('\n') ? '' : '\n'));
  process.exit(0);
}

const data = payload && typeof payload === 'object' ? (payload.data || {}) : {};
const fixes = Array.isArray(data.fixes) ? data.fixes : [];
const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};

const GREEN = '\x1b[0;32m';
const RED = '\x1b[0;31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CHECK_PASS = GREEN + '✔' + RESET;
const CHECK_FAIL = RED + '✘' + RESET;

const lines = [];
lines.push('');
lines.push(BOLD + 'Foolery Doctor — Fix Results' + RESET);
lines.push('');

const attempted = Number(summary.attempted || 0);
const succeeded = Number(summary.succeeded || 0);
const failed = Number(summary.failed || 0);

if (attempted === 0) {
  lines.push('  ' + CHECK_PASS + '  Nothing to fix');
} else {
  for (const fix of fixes) {
    const ok = Boolean(fix && fix.success);
    const check = fix && fix.check ? String(fix.check) : 'unknown';
    const msg = fix && fix.message ? String(fix.message) : '';
    if (ok) {
      lines.push('  ' + CHECK_PASS + '  ' + GREEN + check + RESET + '  ' + msg);
    } else {
      lines.push('  ' + CHECK_FAIL + '  ' + RED + check + RESET + '  ' + msg);
    }
  }
  lines.push('');
  lines.push('  Fixes: ' + GREEN + succeeded + ' succeeded' + RESET + ', ' + RED + failed + ' failed' + RESET + ' (of ' + attempted + ')');
}

lines.push('');
process.stdout.write(lines.join('\n'));
NODE
