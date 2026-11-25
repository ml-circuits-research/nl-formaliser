#!/usr/bin/env node
// Out-of-sample Logistic Confidence Calibrator for nl-formaliser.
// Fits on seed-1337 examples outside the seed-42 WebMeet holdout.
// to fit the 8 transparent symbolic weights in src/confidence-weights.json via L2-regularized
// gradient descent, maximizing calibration (log-loss / Brier) and preserving monotonicity.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { TABS } from '../src/contracts.mjs';
import { csvRows, webmeetHoldoutTexts } from './benchmark.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WORKER_FILE = join(HERE, 'bench-worker.mjs');
const CONF_WEIGHTS_PATH = join(ROOT, 'src', 'confidence-weights.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(x) {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

export async function sampleDisjointRows({ datasetDir, limit = 320, seed = 1337 }) {
  const { readdirSync, existsSync } = await import('node:fs');
  const holdoutTexts = webmeetHoldoutTexts(datasetDir);
  const rng = mulberry32(seed);
  const perTab = Math.ceil(limit / TABS.length);
  const rows = [];
  for (const tab of TABS) {
    const dir = join(datasetDir, tab);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
    const reservoir = [];
    let seen = 0;
    for (const file of files) {
      const iter = csvRows(readFileSync(join(dir, file), 'utf8'));
      const header = iter.next().value;
      if (!header) continue;
      const ti = header.indexOf('text');
      const si = header.indexOf('sop');
      if (ti < 0 || si < 0) continue;
      for (const r of iter) {
        if (r.length <= Math.max(ti, si) || holdoutTexts.has(r[ti])) continue;
        seen++;
        if (reservoir.length < perTab) {
          reservoir.push({ tab, source: `${tab}/${file}`, text: r[ti], goldSop: r[si] });
        } else {
          const j = Math.floor(rng() * seen);
          if (j < perTab) reservoir[j] = { tab, source: `${tab}/${file}`, text: r[ti], goldSop: r[si] };
        }
      }
    }
    rows.push(...reservoir);
  }
  return rows.slice(0, limit);
}

async function collectSamples(rows, { knowledgeDir, workers = 8, spellcheck = true }) {
  const n = rows.length;
  const results = new Array(n);
  let nextIdx = 0;
  let done = 0;
  await new Promise((resolveAll, rejectAll) => {
    const pool = [];
    const stopAll = () => pool.forEach((w) => { try { w.postMessage({ type: 'stop' }); w.terminate(); } catch {} });
    const dispatch = (w) => {
      if (nextIdx >= n) { try { w.postMessage({ type: 'stop' }); } catch {} return; }
      w.postMessage({ type: 'job', idx: nextIdx, row: rows[nextIdx] });
      nextIdx++;
    };
    for (let i = 0; i < Math.min(workers, n); i++) {
      const w = new Worker(WORKER_FILE, {
        workerData: { knowledgeDir, source: 'webmeet', spellcheck, confidence: true },
      });
      pool.push(w);
      w.on('message', (msg) => {
        if (msg.type === 'ready') dispatch(w);
        else if (msg.type === 'result') {
          results[msg.idx] = msg;
          if (++done === n) { stopAll(); resolveAll(); }
          else dispatch(w);
        } else if (msg.type === 'error') {
          stopAll();
          rejectAll(new Error(msg.message));
        }
      });
      w.on('error', (err) => { stopAll(); rejectAll(err); });
    }
  });
  return results;
}

function fitLogistic(samples, { lr = 0.08, steps = 1500, l2 = 0.02 } = {}) {
  // Feature vector x = [1, coverage, unreadCount, warningCount, energyPerToken, marginClamped, ambiguous, spellEditCost]
  const w = [0.0, 2.0, -1.0, -0.8, -0.04, 0.08, -0.5, -0.04];
  const n = samples.length;
  for (let step = 0; step < steps; step++) {
    const grad = new Array(w.length).fill(0);
    for (const { x, y } of samples) {
      let z = 0;
      for (let j = 0; j < w.length; j++) z += w[j] * x[j];
      const err = sigmoid(z) - y;
      for (let j = 0; j < w.length; j++) grad[j] += err * x[j];
    }
    for (let j = 0; j < w.length; j++) {
      const reg = j === 0 ? 0 : l2 * w[j];
      w[j] -= lr * (grad[j] / n + reg);
    }
    // Enforce domain-meaningful sign monotonicity so calibrated weights stay interpretable!
    w[1] = Math.max(0.2, w[1]);     // higher coverage -> higher confidence
    w[2] = Math.min(-0.15, w[2]);   // more unread -> lower confidence
    w[3] = Math.min(-0.1, w[3]);    // more warnings -> lower confidence
    w[4] = Math.min(-0.005, w[4]);  // higher Z3 energy/tok -> lower confidence
    w[5] = Math.max(0.01, w[5]);    // larger Z3 margin -> higher confidence
    w[6] = Math.min(-0.05, w[6]);   // ambiguous Top-1/Top-2 -> lower confidence
    w[7] = Math.min(-0.005, w[7]);  // larger spell edit cost -> lower confidence
  }
  return w;
}

function computeMetrics(samples, w) {
  const preds = samples.map(({ x, y }) => {
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j] * x[j];
    return { s: sigmoid(z), y };
  });
  const pos = preds.filter((p) => p.y === 1);
  const neg = preds.filter((p) => p.y === 0);
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p.s > n.s ? 1 : p.s === n.s ? 0.5 : 0;
  const auroc = pos.length && neg.length ? wins / (pos.length * neg.length) : 0;
  const brier = preds.reduce((a, p) => a + (p.s - p.y) ** 2, 0) / Math.max(1, preds.length);
  return { auroc, brier };
}

async function main() {
  const datasetDir = resolve(join(ROOT, '..', 'webmeet-dataset'));
  const knowledgeDir = resolve(process.env.SOP_KNOWLEDGE ?? join(ROOT, '..', 'sop-knowledge-worlds'));
  const rows = await sampleDisjointRows({ datasetDir, limit: 320, seed: 1337 });
  console.log(`Calibrating confidence on ${rows.length} disjoint rows (seed=1337, workers=8)...`);
  const results = await collectSamples(rows, { knowledgeDir, workers: 8, spellcheck: true });

  const samples = [];
  for (const r of results) {
    if (!r?.conf?.signals) continue;
    // Exclude rows where Gold itself is flawed at check.mjs so Gold bugs don't bias formaliser confidence downward!
    if (r.cmp.goldAnnotationFlawed && r.cmp.fairCategory !== 'pred_better_than_gold') continue;
    const sig = r.conf.signals;
    const marginClamped = sig.margin !== null ? Math.min(20, sig.margin) : 8;
    // Label: 1 if semantically exact, better than gold, or structurally usable (act + family + F1 >= 0.5)
    const isUsable =
      r.cmp.fairCategory === 'exact_match' ||
      r.cmp.fairCategory === 'pred_better_than_gold' ||
      (r.cmp.actExact && r.cmp.targetFamilyExact && r.cmp.constraintAliasF1 >= 0.5)
        ? 1
        : 0;
    samples.push({
      x: [
        1,
        sig.coverage,
        sig.unreadCount,
        sig.warningCount,
        sig.energyPerToken,
        marginClamped,
        r.conf.ambiguous ? 1 : 0,
        sig.spellEditCost,
      ],
      y: isUsable,
    });
  }

  const fitted = fitLogistic(samples);
  const metrics = computeMetrics(samples, fitted);
  const out = {
    version: 'v9-calibrated',
    note: 'Calibrated out-of-sample on clean-Gold disjoint webmeet-dataset rows (seed=1337, disjoint from seed=42 eval).',
    bias: Number(fitted[0].toFixed(4)),
    wCoverage: Number(fitted[1].toFixed(4)),
    wUnreadCount: Number(fitted[2].toFixed(4)),
    wWarningCount: Number(fitted[3].toFixed(4)),
    wEnergyPerTok: Number(fitted[4].toFixed(4)),
    wMarginClamped: Number(fitted[5].toFixed(4)),
    wAmbiguous: Number(fitted[6].toFixed(4)),
    wSpellEditCost: Number(fitted[7].toFixed(4)),
    bands: {
      high: 0.38,
      medium: 0.24,
      low: 0.12,
    },
  };

  writeFileSync(CONF_WEIGHTS_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Calibrated weights written to ${CONF_WEIGHTS_PATH}`);
  console.log(`Disjoint dev (N=${samples.length}, usable=${samples.filter((s) => s.y === 1).length}): AUROC=${metrics.auroc.toFixed(3)}, Brier=${metrics.brier.toFixed(3)}`);
  console.log(JSON.stringify(out, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
