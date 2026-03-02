#!/usr/bin/env node

/**
 * Soft coverage regression gate for CI.
 *
 * Compares current vitest coverage output against a committed baseline.
 * - Drops: prints ::warning:: GitHub Actions annotations (never fails the build).
 * - Improvements: prints success message and auto-updates the baseline file.
 * - Missing baseline: creates one from current values.
 *
 * Always exits 0.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COVERAGE_SUMMARY_PATH = resolve(ROOT, 'coverage', 'coverage-summary.json');
const BASELINE_PATH = resolve(ROOT, 'coverage-baseline.json');

const METRICS = ['statements', 'branches', 'functions', 'lines'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function extractCurrentCoverage(summary) {
  const totals = summary?.total;
  if (!totals) return null;

  const result = {};
  for (const metric of METRICS) {
    const pct = totals[metric]?.pct;
    if (typeof pct !== 'number') return null;
    result[metric] = pct;
  }
  return result;
}

function writeBaseline(values) {
  const payload = { ...values, timestamp: new Date().toISOString() };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const summary = readJSON(COVERAGE_SUMMARY_PATH);
  if (!summary) {
    console.log('Coverage summary not found at', COVERAGE_SUMMARY_PATH);
    console.log('Skipping coverage regression check.');
    return;
  }

  const current = extractCurrentCoverage(summary);
  if (!current) {
    console.log('Could not parse coverage metrics from summary. Skipping.');
    return;
  }

  const baseline = readJSON(BASELINE_PATH);
  if (!baseline) {
    console.log('No coverage baseline found. Creating initial baseline.');
    writeBaseline(current);
    printTable(current, null);
    return;
  }

  const drops = [];
  const improvements = [];

  for (const m of METRICS) {
    const prev = baseline[m];
    const curr = current[m];
    if (typeof prev !== 'number') continue;
    if (curr < prev) drops.push({ metric: m, prev, curr });
    else if (curr > prev) improvements.push({ metric: m, prev, curr });
  }

  printTable(current, baseline);

  if (drops.length > 0) {
    for (const d of drops) {
      const delta = (d.curr - d.prev).toFixed(2);
      console.log(
        `::warning::Coverage regression: ${d.metric} dropped from ${d.prev}% to ${d.curr}% (${delta}%)`,
      );
    }
  }

  if (improvements.length > 0) {
    console.log('\nCoverage improved! Updating baseline.');
    writeBaseline(current);
  } else if (drops.length === 0) {
    console.log('\nCoverage unchanged.');
  }
}

function printTable(current, baseline) {
  console.log('\n--- Coverage Report ---');
  console.log('Metric'.padEnd(14) + 'Current'.padStart(10) + 'Baseline'.padStart(10));
  for (const m of METRICS) {
    const curr = `${current[m]}%`;
    const prev = baseline && typeof baseline[m] === 'number' ? `${baseline[m]}%` : 'n/a';
    console.log(m.padEnd(14) + curr.padStart(10) + prev.padStart(10));
  }
}

main();
