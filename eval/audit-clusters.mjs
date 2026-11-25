// Fast disjoint dev-split root-cause cluster auditor for nl-formaliser.
// Uses seed=1337 (disjoint from seed=42 unseen holdout) to rank top generic failure modes.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { csvRows } from './benchmark.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATASET_DIR = resolve(ROOT, '..', 'webmeet-dataset');
const WORKER_FILE = join(HERE, 'bench-worker.mjs');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return def;
  const nxt = args[idx + 1];
  return nxt === undefined || nxt.startsWith('--') ? true : nxt;
};

const limit = Number(getArg('limit', 200));
const seed = Number(getArg('seed', 1337));
const workers = Number(getArg('workers', 10));
const spellcheck = Boolean(getArg('spellcheck', false));
const z3Eval = Boolean(getArg('z3-eval', false));
const maxProposals = Number(getArg('max-proposals', 8));
const perTabTopK = Number(getArg('per-tab-topk', 2));

function mulberry32(s) {
  let a = s >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stratified sample proportional to dataset size using disjoint seed
const all = [];
for (const tab of ['drawing', 'diagram', 'document', 'calendar']) {
  const dir = join(DATASET_DIR, tab);
  for (const fn of readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
    const rows = [...csvRows(readFileSync(join(dir, fn), 'utf8'))];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] && rows[i][1]) all.push({ tab, source: `${tab}/${fn}:${i + 1}`, text: rows[i][0], goldSop: rows[i][1] });
    }
  }
}
const rng = mulberry32(seed);
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const sample = all.slice(0, limit);

const results = new Array(sample.length);
let nextIdx = 0;
let done = 0;

await new Promise((resolveAll, rejectAll) => {
  const pool = [];
  const dispatch = (w) => {
    if (nextIdx >= sample.length) { try { w.postMessage({ type: 'stop' }); } catch {} return; }
    w.postMessage({ type: 'job', idx: nextIdx, row: sample[nextIdx] });
    nextIdx++;
  };
  for (let i = 0; i < Math.min(workers, sample.length); i++) {
    const w = new Worker(WORKER_FILE, {
      workerData: {
        knowledgeDir: resolve(ROOT, '..', 'sop-knowledge-worlds'),
        source: 'webmeet',
        spellcheck,
        confidence: false,
        tabAgnostic: true,
        z3Eval,
        maxProposals,
        perTabTopK,
      },
    });
    pool.push(w);
    w.on('message', (msg) => {
      if (msg.type === 'ready') dispatch(w);
      else if (msg.type === 'result') {
        results[msg.idx] = msg;
        if (++done === sample.length) {
          for (const x of pool) { try { x.terminate(); } catch {} }
          resolveAll();
        } else dispatch(w);
      } else if (msg.type === 'error') {
        for (const x of pool) { try { x.terminate(); } catch {} }
        rejectAll(new Error(msg.message));
      }
    });
    w.on('error', rejectAll);
  }
});

const gradeCounts = { L0: 0, L1a: 0, L1b: 0, L1c: 0, L1d: 0, L2a: 0, L2b: 0, L2c: 0, L3: 0, L4: 0 };
const byTab = {};
const l1aPairs = new Map();
const l1bPairs = new Map();
const l1cFp = new Map();
const l1cFn = new Map();
const l1dWhy = new Map();
const unreadWords = new Map();
const sampleByGrade = { L0: [], L1a: [], L1b: [], L1c: [], L1d: [], L2a: [], L2b: [] };

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const topN = (m, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

let cleanGoldTotal = 0;
let cleanGoldOk = 0;

for (let i = 0; i < sample.length; i++) {
  const row = sample[i];
  const { predSop, cmp } = results[i];
  const g = cmp.legendGrade;
  gradeCounts[g] = (gradeCounts[g] ?? 0) + 1;
  if (!byTab[row.tab]) byTab[row.tab] = { n: 0, ok: 0, l1a: 0, l1b: 0, l1c: 0, l1d: 0, l2: 0, l0: 0 };
  const tb = byTab[row.tab];
  tb.n++;
  if (g === 'L3' || g === 'L4') tb.ok++;
  else if (g === 'L0') tb.l0++;
  else if (g === 'L1a') tb.l1a++;
  else if (g === 'L1b') tb.l1b++;
  else if (g === 'L1c') tb.l1c++;
  else if (g === 'L1d') tb.l1d++;
  else tb.l2++;

  if (!cmp.goldAnnotationFlawed && !cmp.inputHasTypo) {
    cleanGoldTotal++;
    if (g === 'L3' || g === 'L4') cleanGoldOk++;
  }

  for (const m of predSop.matchAll(/w\.request\.unread\b[^|\n]*text=("[^"]+"|\S+)/g)) {
    bump(unreadWords, m[1].replace(/^"|"$/g, '').toLowerCase());
  }

  if (g === 'L1a') {
    const pAct = predSop.match(/act=(\S+)/)?.[1] ?? 'none';
    const gAct = row.goldSop.match(/act=(\S+)/)?.[1] ?? 'none';
    const pMood = predSop.match(/mood=(\S+)/)?.[1] ?? 'none';
    const gMood = row.goldSop.match(/mood=(\S+)/)?.[1] ?? 'none';
    const pReq = (predSop.match(/w\.request\.request/g) ?? []).length;
    const gReq = (row.goldSop.match(/w\.request\.request/g) ?? []).length;
    bump(l1aPairs, `${pAct}/${pMood}(r=${pReq}) vs ${gAct}/${gMood}(r=${gReq})`);
  } else if (g === 'L1b') {
    const pFam = predSop.match(/family=(\S+)/)?.[1] ?? 'none';
    const gFam = row.goldSop.match(/family=(\S+)/)?.[1] ?? 'none';
    const pMod = predSop.match(/mode=(new|existing)/)?.[1] ?? 'none';
    const gMod = row.goldSop.match(/mode=(new|existing)/)?.[1] ?? 'none';
    bump(l1bPairs, `[${row.tab}] ${pFam}/${pMod} vs ${gFam}/${gMod}`);
  } else if (g === 'L1c') {
    const pAs = [...predSop.matchAll(/attribute=(\S+)/g)].map((m) => m[1]);
    const gAs = [...row.goldSop.matchAll(/attribute=(\S+)/g)].map((m) => m[1]);
    for (const a of pAs) if (!gAs.includes(a)) bump(l1cFp, a);
    for (const a of gAs) if (!pAs.includes(a)) bump(l1cFn, a);
  } else if (g === 'L1d') {
    const pReq = (predSop.match(/w\.request\.request/g) ?? []).length;
    const gReq = (row.goldSop.match(/w\.request\.request/g) ?? []).length;
    if (pReq > gReq) bump(l1dWhy, `extra_req(${pReq}>${gReq})`);
    else {
      const pAs = [...predSop.matchAll(/attribute=(\S+)/g)].map((m) => m[1]);
      const gAs = [...row.goldSop.matchAll(/attribute=(\S+)/g)].map((m) => m[1]);
      const extra = pAs.filter((a) => !gAs.includes(a));
      bump(l1dWhy, extra.length ? `extra_attr:${extra[0]}` : 'extra_val_or_phase');
    }
  }

  const maxSamples = Number(getArg('samples', 5));
  const fullOut = Boolean(getArg('full', false));
  if (sampleByGrade[g] && sampleByGrade[g].length < maxSamples && !cmp.goldAnnotationFlawed && !cmp.inputHasTypo) {
    const pFlat = predSop.replace(/\r?\n/g, ' | ');
    const gFlat = row.goldSop.replace(/\r?\n/g, ' | ');
    sampleByGrade[g].push({
      tab: row.tab,
      text: row.text,
      pred: fullOut ? pFlat : pFlat.slice(0, 200),
      gold: fullOut ? gFlat : gFlat.slice(0, 200),
    });
  }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '0.0%');
const okTot = gradeCounts.L3 + gradeCounts.L4;
console.log(`\n=== DEV AUDIT (seed=${seed}, N=${sample.length}, spellcheck=${spellcheck}, maxProposals=${maxProposals}) ===`);
console.log(`Reasonable (L3+L4): ${okTot}/${sample.length} (${pct(okTot, sample.length)}) | CleanGold+CleanText: ${cleanGoldOk}/${cleanGoldTotal} (${pct(cleanGoldOk, cleanGoldTotal)})`);
console.log('Grades:', Object.entries(gradeCounts).map(([k, v]) => `${k}=${pct(v, sample.length)}(${v})`).join('  '));
console.log('By tab:');
for (const [t, tb] of Object.entries(byTab)) {
  console.log(`  ${t.padEnd(9)} N=${String(tb.n).padStart(3)}  L3+L4=${pct(tb.ok, tb.n).padStart(5)}  L0=${tb.l0} L1a=${tb.l1a} L1b=${tb.l1b} L1c=${tb.l1c} L1d=${tb.l1d} L2=${tb.l2}`);
}
console.log('\nTop L1a pairs:', topN(l1aPairs, 12));
console.log('Top L1b pairs:', topN(l1bPairs, 10));
console.log('Top L1c FP attrs:', topN(l1cFp, 10));
console.log('Top L1c FN attrs:', topN(l1cFn, 10));
console.log('Top L1d causes:', topN(l1dWhy, 10));
console.log('Top unread tokens:', topN(unreadWords, 15));

const showCount = Number(getArg('samples', 4));
for (const g of ['L1a', 'L1b', 'L1c', 'L1d', 'L2a', 'L2b', 'L2c']) {
  if (!sampleByGrade[g]?.length) continue;
  console.log(`\n--- Clean-Gold ${g} examples ---`);
  for (const e of sampleByGrade[g].slice(0, showCount)) {
    console.log(`[${e.tab}] "${e.text}"`);
    console.log(`  P: ${e.pred}`);
    console.log(`  G: ${e.gold}`);
  }
}
