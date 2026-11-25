// Fair stratified benchmark runner for nl-formaliser.
// Supports --source webmeet|test|dev|keys, --sample-pct, --limit, --tabs, --seed, --json, --verbose.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

import { TABS, unquoteSop } from '../src/contracts.mjs';
import { createVerifier } from '../src/verify/check.mjs';
import { compareCircuits, compareProposals } from './compare.mjs';
import { createZ3SemanticEvaluator } from './z3-equiv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WORKER_FILE = join(HERE, 'bench-worker.mjs');

// Both development samplers use the exact same selection as the standard WebMeet benchmark.
export function webmeetHoldoutTexts(datasetDir) {
  const rows = loadRows({ source: 'webmeet', datasetDir, tabs: TABS, samplePct: 1, seed: 42 });
  return new Set(rows.map(({ text }) => text));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) continue;
    const key = x.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// Deterministic Mulberry32 PRNG.
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

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Fast streaming RFC 4180 CSV reader (slices contiguous chunks instead of char-by-char string concat).
export function* csvRows(text) {
  const n = text.length;
  let row = [];
  let i = 0;
  while (i < n) {
    let field = '';
    if (text[i] === '"') {
      i++; // skip opening quote
      let segStart = i;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += text.slice(segStart, i + 1);
            i += 2;
            segStart = i;
          } else {
            field += text.slice(segStart, i);
            i++; // skip closing quote
            break;
          }
        } else {
          i++;
        }
      }
      if (i < n && text[i] === '\r') i++;
    } else {
      const segStart = i;
      while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') i++;
      field = text.slice(segStart, i);
      if (i < n && text[i] === '\r') i++;
    }
    row.push(field);
    if (i < n && text[i] === ',') {
      i++;
      if (i === n) { row.push(''); yield row; row = []; }
    } else if (i < n && text[i] === '\n') {
      i++;
      yield row;
      row = [];
    } else {
      yield row;
      row = [];
    }
  }
}

// One corpus record per input text. Each reference keeps its own wire scope.
export function* webmeetCsvRows(csv, file) {
  const rows = csvRows(csv.replace(/^\uFEFF/, ''));
  const columns = rows.next().value;
  if (!columns) return;
  const [textColumn, ...sopColumns] = columns;
  if (textColumn !== 'text' || sopColumns[0] !== 'sop' ||
      sopColumns.slice(1).some((column, i) => column !== `sop${i + 1}`)) {
    throw new Error(`${file}: expected text,sop followed by optional sop1,sop2,... columns`);
  }
  let record = 1;
  for (const cells of rows) {
    record++;
    if (cells.length === 1 && !cells[0].trim()) continue;
    const source = `${file}:${record}`;
    if (cells.length < 2 || cells.length > columns.length) {
      throw new Error(`${source}: CSV row does not match its header`);
    }
    const [text, goldSop] = cells;
    const goldReferences = sopColumns
      .map((column, i) => ({ column, sop: cells[i + 1] ?? '' }))
      .filter(({ sop }) => sop.trim());
    yield { source, text, goldSop, goldReferences };
  }
}

// Render official-dataset JSONL row into canonical w.request SOP Lang (mirrors official-dataset/sop_dataset.py).
const ATOM_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const OFFICIAL_ACTS = {
  answer: ['ask', null],
  select: ['pick', null],
  arrange: ['place', 'arrange'],
  merge: ['group', 'merge'],
  ungroup: ['take apart', 'ungroup'],
  split: ['take apart', 'split'],
  disconnect: ['take apart', 'disconnect'],
  reverse: ['change', 'reverse'],
  set: ['change', 'set'],
  repeat: ['copy', 'repeat'],
};
const TARGET_FIELDS = [
  ['type', 'family'], ['mode', 'mode'], ['determiner', 'determiner'], ['det', 'determiner'],
  ['fill', 'fill'], ['kind', 'sort'], ['kind_span', 'sort_words'], ['name_span', 'name'],
  ['description_span', 'description'], ['count_span', 'count_words'], ['count', 'count'],
  ['quantifier', 'quantifier'], ['quant', 'quantity'], ['ordinal', 'ordinal'], ['code_span', 'code_words'],
];
const CONSTRAINT_FIELDS = [
  ['operator', 'operator'], ['phase', 'phase'], ['character', 'character'], ['step', 'step'],
  ['unit', 'unit'], ['measure', 'measure'], ['measure_span', 'measure_words'],
  ['scope', 'scope'], ['open_value', 'open_value'],
];
const DEFAULTS = { polarity: 'positive', character: 'requirement' };

function fmtSop(v) {
  if (typeof v === 'string' && DATETIME_RE.test(v)) return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return ATOM_RE.test(s) && s !== 'true' && s !== 'false' ? s : JSON.stringify(s);
}

function fmtSlots(pairs) {
  return pairs
    .map(([k, v]) => (typeof v === 'string' && v.startsWith('$') ? `${k}=${v}` : `${k}=${fmtSop(v)}`))
    .join(' ');
}

function onOf(c) {
  const key = c.key;
  const op = c.operator;
  if (op === 'relation') return 'place';
  if (key.endsWith('.count') || key.endsWith('.n')) return 'count';
  const shortKey = key.includes('.') ? key.split('.').slice(1).join('.') : key;
  if ((op === 'degree' || op === 'delta') && ['size', 'scale', 'width', 'height', 'length'].includes(shortKey)) return 'size';
  return 'attribute';
}

export function renderOfficialRow(r) {
  const out = [];
  for (let j = 0; j < (r.filler ?? []).length; j++) {
    out.push(`@f${j + 1} w.request.filler ${fmtSlots([['text', r.filler[j]]])}`);
  }
  if (r.context?.previous != null) {
    out.push(`@prev w.request.previous ${fmtSlots([['text', r.context.previous]])}`);
  }
  if (r.context?.clock) {
    out.push(`@clock w.request.clock ${fmtSlots([['now', r.context.clock.now], ['timezone', r.context.clock.timezone]])}`);
  }
  const reqs = r.requests ?? [];
  for (let n = 0; n < reqs.length; n++) {
    const q = reqs[n];
    const rid = `r${n + 1}`;
    const [act, mode] = OFFICIAL_ACTS[q.act] ?? [q.act, null];
    const s = [['act', act]];
    if (mode) s.push(['mode', mode]);
    s.push(['mood', q.mood]);
    if (q.span !== r.text) s.push(['words', q.span]);
    if (q.trigger) s.push(['predicate', q.trigger]);
    if (q.question) {
      s.push(['question', q.question.ask]);
      if (q.question.asked_key) s.push(['asked', q.question.asked_key]);
      for (const aw of q.asked_words ?? []) s.push(['asked_words', aw]);
    }
    if (q.spanOrigin === 'surface-hull') s.push(['words_origin', 'hull']);
    out.push(`@${rid} w.request.request ${fmtSlots(s)}`);

    const t = q.target ?? {};
    const ts = [['request', `$${rid}`]];
    for (const [a, b] of TARGET_FIELDS) {
      if (t[a] != null && !(a === 'kind_span' && t[a] === t.kind)) {
        ts.push([b, a === 'count' ? Number(t[a]) : t[a]]);
      }
    }
    for (const x of t.ids ?? []) ts.push(['ids', x]);
    for (const x of t.family_words ?? []) ts.push(['family_words', x]);
    for (const x of t.name_words ?? []) ts.push(['name_words', x]);
    out.push(`@${rid}.t w.request.target ${fmtSlots(ts)}`);

    for (let j = 0; j < (q.lookup ?? []).length; j++) {
      const lk = q.lookup[j];
      out.push(`@${rid}.l${j + 1} w.request.lookup ${fmtSlots([['request', `$${rid}`], ['target', `$${rid}.t`], ['key', lk.key], ['from', lk.from]])}`);
    }
    for (let j = 0; j < (q.constraints ?? []).length; j++) {
      const c = q.constraints[j];
      const cs = [['request', `$${rid}`], ['on', onOf(c)], ['attribute', c.key]];
      const v = c.value;
      if (Array.isArray(v)) {
        for (const x of v) cs.push(['value', x]);
      } else if ('value' in c) {
        cs.push(['value', v]);
      }
      if (!((typeof v === 'string' || typeof v === 'number') && 'value' in c && String(v) === c.value_span)) {
        if (c.value_span !== undefined) cs.push(['words', c.value_span]);
      }
      if (c.polarity && c.polarity !== 'positive') {
        cs.push(c.polarity === 'negative' ? ['want', 'no'] : ['polarity', c.polarity]);
      }
      for (const [a, b] of CONSTRAINT_FIELDS) {
        if (a in c && c[a] !== DEFAULTS[a] && c[a] !== undefined) {
          cs.push([b, a === 'measure' ? Number(c[a]) : c[a]]);
        }
      }
      for (const x of c.key_words ?? []) cs.push(['key_words', x]);
      out.push(`@${rid}.c${j + 1} w.request.constraint ${fmtSlots(cs)}`);
    }
    for (let j = 0; j < (q.needs ?? []).length; j++) {
      const nd = q.needs[j];
      const ns = [['request', `$${rid}`], ['text', nd.span], ['note', nd.frame]];
      if (Array.isArray(nd.value)) {
        for (const x of nd.value) ns.push(['value', x]);
      } else if (nd.value != null) {
        ns.push(['value', nd.value]);
      }
      out.push(`@${rid}.u${j + 1} w.request.unread ${fmtSlots(ns)}`);
    }
  }
  return out.join('\n');
}

function loadRows({ source, datasetDir, officialDir, knowledgeDir, tabs, samplePct, limit, seed }) {
  const rng = mulberry32(seed);
  const byTab = new Map(tabs.map((t) => [t, []]));

  if (source === 'webmeet') {
    const perTabCap = limit != null && Number.isFinite(limit)
      ? Math.max(20, Math.ceil((limit / Math.max(1, tabs.length)) * 2))
      : Infinity;
    for (const tab of tabs) {
      const dir = join(datasetDir, tab);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
      const reservoir = [];
      let seenInTab = 0;
      for (const file of files) {
        const path = `${tab}/${file}`;
        for (const row of webmeetCsvRows(readFileSync(join(dir, file), 'utf8'), path)) {
          if (samplePct != null && samplePct < 100) {
            if (rng() * 100 >= samplePct) continue;
          }
          seenInTab++;
          if (reservoir.length < perTabCap) {
            reservoir.push({ ...row, tab });
          } else {
            const j = Math.floor(rng() * seenInTab);
            if (j < perTabCap) {
              reservoir[j] = { ...row, tab };
            }
          }
        }
      }
      byTab.get(tab).push(...reservoir);
    }
  } else if (source === 'test' || source === 'dev') {
    const filePath = join(officialDir, `${source}.jsonl`);
    if (!existsSync(filePath)) throw new Error(`Official dataset file not found: ${filePath}`);
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (!byTab.has(r.world)) continue;
      byTab.get(r.world).push({
        tab: r.world,
        source: `${source}:${r.source}`,
        text: r.text,
        goldSop: renderOfficialRow(r),
        previous: r.context?.previous ?? undefined,
        clock: r.context?.clock ?? undefined,
      });
    }
    if (samplePct != null && samplePct < 100) {
      for (const tab of tabs) {
        const arr = byTab.get(tab);
        shuffleInPlace(arr, rng);
        const take = arr.length ? Math.max(1, Math.round((arr.length * samplePct) / 100)) : 0;
        byTab.set(tab, arr.slice(0, take));
      }
    }
  } else if (source === 'keys') {
    const keysPath = join(knowledgeDir, 'docs', 'worlds', 'w.request', 'shards', 'keys.sop');
    const content = readFileSync(keysPath, 'utf8');
    // Parse key declarations with regex on lines or via simple token extraction for about="..."
    for (const line of content.split('\n')) {
      if (!line.includes(' w.request.key ')) continue;
      const tabMatch = line.match(/\btab=(\S+)/);
      const nameMatch = line.match(/\bname=(\S+)/);
      const aboutMatch = line.match(/\babout=("(?:[^"\\]|\\.)*")/);
      if (!tabMatch || !nameMatch || !aboutMatch) continue;
      const tab = tabMatch[1];
      if (!byTab.has(tab)) continue;
      const about = JSON.parse(aboutMatch[1]);
      const exMatch = about.match(/\("([^"]+)"\)/);
      if (!exMatch) continue;
      byTab.get(tab).push({
        tab,
        source: `keys.sop:${nameMatch[1]}`,
        text: exMatch[1],
        expectedKey: nameMatch[1],
        goldSop: null,
      });
    }
  } else {
    throw new Error(`Unknown --source ${source} (expected webmeet|test|dev|keys)`);
  }

  // Stratified limit across active tabs.
  const sampled = [];
  if (limit != null && Number.isFinite(limit)) {
    const nonEmpty = tabs.filter((t) => byTab.get(t).length > 0);
    const totalAvail = nonEmpty.reduce((s, t) => s + byTab.get(t).length, 0);
    if (totalAvail <= limit) {
      for (const t of nonEmpty) sampled.push(...byTab.get(t));
    } else {
      for (const t of nonEmpty) shuffleInPlace(byTab.get(t), rng);
      const quotas = new Map();
      let allocated = 0;
      for (const t of nonEmpty) {
        const q = Math.max(1, Math.floor((byTab.get(t).length / totalAvail) * limit));
        const capped = Math.min(q, byTab.get(t).length);
        quotas.set(t, capped);
        allocated += capped;
      }
      // Trim or top-up to exact limit.
      let idx = 0;
      while (allocated < limit) {
        const t = nonEmpty[idx % nonEmpty.length];
        if (quotas.get(t) < byTab.get(t).length) {
          quotas.set(t, quotas.get(t) + 1);
          allocated++;
        }
        idx++;
        if (idx > nonEmpty.length * 10000) break;
      }
      while (allocated > limit) {
        const t = nonEmpty[idx % nonEmpty.length];
        if (quotas.get(t) > 1) {
          quotas.set(t, quotas.get(t) - 1);
          allocated--;
        }
        idx++;
        if (idx > nonEmpty.length * 10000) break;
      }
      for (const t of nonEmpty) {
        sampled.push(...byTab.get(t).slice(0, quotas.get(t)));
      }
    }
  } else {
    for (const t of tabs) sampled.push(...byTab.get(t));
  }
  return sampled;
}

function extractContextFromSop(sopText, verifier) {
  let previous;
  let clock;
  if (!sopText) return { previous, clock };
  try {
    const wires = verifier.parse(sopText);
    for (const w of wires) {
      if (w.type === 'w.request.previous' && w.attrs.text?.[0]) {
        previous = unquoteSop(w.attrs.text[0]);
      } else if (w.type === 'w.request.clock') {
        clock = {
          now: w.attrs.now?.[0] ? unquoteSop(w.attrs.now[0]) : undefined,
          timezone: w.attrs.timezone?.[0] ? unquoteSop(w.attrs.timezone[0]) : undefined,
        };
      }
    }
  } catch {
    // Ignore unparseable goldSop here; compareCircuits will flag gold_has_errors.
  }
  return { previous, clock };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pct(num, den) {
  return den ? ((100 * num) / den).toFixed(1) + '%' : '0.0%';
}

function summarizeGroup(records) {
  const n = records.length;
  const latencies = records.map((r) => r.ms).sort((a, b) => a - b);
  const meanMs = n ? latencies.reduce((a, b) => a + b, 0) / n : 0;
  const p50Ms = percentile(latencies, 50);
  const p95Ms = percentile(latencies, 95);

  const count = (fn) => records.filter(fn).length;
  const predValid = count((r) => r.cmp.predValid);
  const predZeroWarn = count((r) => r.cmp.predZeroWarn);
  const goldValid = count((r) => r.cmp.goldValid);
  const goldZeroWarn = count((r) => r.cmp.goldZeroWarn);
  const goldFlawed = count((r) => r.cmp.goldAnnotationFlawed);
  const exactMatch = count((r) => r.cmp.fairCategory === 'exact_match');
  const betterThanGold = count((r) => r.cmp.fairCategory === 'pred_better_than_gold');
  const noisyPartial = count((r) => r.cmp.fairCategory === 'gold_noisy_both_partial');
  const predPartial = count((r) => r.cmp.fairCategory === 'pred_partial');
  const predWrong = count((r) => r.cmp.fairCategory === 'pred_wrong');

  const cleanGold = records.filter((r) => r.cmp.goldValid && r.cmp.goldZeroWarn);
  const cleanGoldExact = cleanGold.filter((r) => r.cmp.fairCategory === 'exact_match').length;

  const actExact = count((r) => r.cmp.actExact);
  const targetFamilyExact = count((r) => r.cmp.targetFamilyExact);
  const avgStrictF1 = n ? records.reduce((s, r) => s + r.cmp.constraintStrictF1.f1, 0) / n : 0;
  const avgAliasF1 = n ? records.reduce((s, r) => s + r.cmp.constraintAliasF1.f1, 0) / n : 0;

  return {
    n,
    predValid,
    predZeroWarn,
    goldValid,
    goldZeroWarn,
    goldFlawed,
    exactMatch,
    betterThanGold,
    effectiveSuccess: exactMatch + betterThanGold,
    partial: noisyPartial + predPartial,
    noisyPartial,
    predPartial,
    predWrong,
    cleanGoldN: cleanGold.length,
    cleanGoldExact,
    actExact,
    targetFamilyExact,
    avgStrictF1,
    avgAliasF1,
    meanMs,
    p50Ms,
    p95Ms,
  };
}

async function runWithWorkerPool(rows, { workers, source, knowledgeDir, spellcheck = false, confidence = false, tabAgnostic = false, z3Eval = false, maxProposals = 6, perTabTopK = 2 }) {
  const n = rows.length;
  const results = new Array(n);
  if (n === 0) return results;

  const numWorkers = Math.min(workers, n);
  let nextIdx = 0;
  let completed = 0;

  await new Promise((resolveAll, rejectAll) => {
    const pool = [];
    let failed = false;

    const shutdownAll = () => {
      for (const w of pool) {
        try { w.postMessage({ type: 'stop' }); } catch {}
        try { w.terminate(); } catch {}
      }
    };

    const dispatch = (w) => {
      if (failed) return;
      if (nextIdx >= n) {
        try { w.postMessage({ type: 'stop' }); } catch {}
        return;
      }
      const idx = nextIdx++;
      w.postMessage({ type: 'job', idx, row: rows[idx] });
    };

    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(WORKER_FILE, {
        workerData: { knowledgeDir, source, spellcheck, confidence, tabAgnostic, z3Eval, maxProposals, perTabTopK },
      });
      pool.push(w);
      w.on('message', (msg) => {
        if (failed) return;
        if (msg.type === 'ready') {
          dispatch(w);
        } else if (msg.type === 'result') {
          results[msg.idx] = msg;
          completed++;
          if (n >= 400 && (completed % 250 === 0 || completed === n)) {
            console.log(`  progress: ${completed}/${n} (${pct(completed, n)})`);
          }
          if (completed === n) {
            shutdownAll();
            resolveAll();
          } else {
            dispatch(w);
          }
        } else if (msg.type === 'error') {
          failed = true;
          shutdownAll();
          rejectAll(new Error(`Worker error on row ${msg.idx}: ${msg.message}`));
        }
      });
      w.on('error', (err) => {
        if (failed) return;
        failed = true;
        shutdownAll();
        rejectAll(err);
      });
    }
  });

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = String(args.source ?? 'webmeet');
  const datasetDir = resolve(String(args.dataset ?? join(ROOT, '..', 'webmeet-dataset')));
  const officialDir = resolve(String(args.official ?? join(ROOT, '..', 'psys2', 'official-dataset')));
  const knowledgeDir = resolve(String(args.knowledge ?? process.env.SOP_KNOWLEDGE ?? join(ROOT, '..', 'sop-knowledge-worlds')));
  const tabs = (args.tabs ? String(args.tabs).split(',') : [...TABS]).filter((t) => TABS.includes(t));
  const samplePct = args['sample-pct'] !== undefined ? Number(args['sample-pct']) : null;
  const limit = args.limit !== undefined ? Number(args.limit) : null;
  const seed = Number(args.seed ?? 42);
  const workers = Math.max(1, Number(args.workers ?? 1));
  const spellcheck = Boolean(args.spellcheck);
  const confidence = Boolean(args.confidence);
  const tabAgnostic = Boolean(args['tab-agnostic']);
  const z3Eval = Boolean(args['z3-eval']);
  const maxProposals = Number(args['max-proposals'] ?? 8);
  const perTabTopK = Number(args['per-tab-topk'] ?? 2);
  const verbose = Boolean(args.verbose);
  const jsonOut = typeof args.json === 'string' ? resolve(args.json) : null;

  const rows = loadRows({ source, datasetDir, officialDir, knowledgeDir, tabs, samplePct, limit, seed });
  console.log(`Loaded ${rows.length} rows (source=${source}, tabs=${tabs.join(',')}, seed=${seed}, workers=${workers}, spellcheck=${spellcheck}, confidence=${confidence}, tabAgnostic=${tabAgnostic}, z3Eval=${z3Eval}, maxProposals=${maxProposals})`);

  let verifier = null;
  let formaliseFn = null;
  let z3Evaluator = null;
  if (workers === 1) {
    verifier = await createVerifier({ knowledgeDir });
    let createFormaliser;
    try {
      ({ createFormaliser } = await import('../src/index.mjs'));
    } catch (err) {
      console.error(`Failed to import ../src/index.mjs: ${err.message}`);
      process.exit(1);
    }
    const formaliser = await createFormaliser({ knowledgeDir, spellcheck, includeLegacy: source !== 'webmeet' });
    formaliseFn = source === 'webmeet' ? formaliser.formaliseCurrentText : formaliser.formalise;
    if (z3Eval) z3Evaluator = await createZ3SemanticEvaluator({ kb: formaliser.kb, verifier });
  }

  if (source === 'keys') {
    const records = [];
    if (workers > 1) {
      const resList = await runWithWorkerPool(rows, { workers, source, knowledgeDir });
      for (let i = 0; i < rows.length; i++) {
        const r = resList[i];
        records.push({ row: rows[i], predSop: r.predSop, ok: r.ok, keyHit: r.keyHit, ms: r.ms });
      }
    } else {
      for (const row of rows) {
        const t0 = performance.now();
        const res = await formaliseFn(row.text, { tab: row.tab });
        const ms = performance.now() - t0;
        const predSop = typeof res === 'string' ? res : (res?.sop ?? res?.circuit ?? '');
        const predCheck = verifier.check(row.text, predSop, row.tab);
        const wires = predCheck.wires ?? [];
        const keyHit = wires.some((w) =>
          (w.type === 'w.request.constraint' && unquoteSop(w.attrs.attribute?.[0]) === row.expectedKey) ||
          (w.type === 'w.request.request' && unquoteSop(w.attrs.asked?.[0]) === row.expectedKey)
        );
        records.push({ row, predSop, ok: predCheck.ok, keyHit, ms });
        if (verbose && (!predCheck.ok || !keyHit)) {
          console.log(`[${row.tab}] ${row.expectedKey} | "${row.text}" -> ok=${predCheck.ok} keyHit=${keyHit}\n${predSop}\n`);
        }
      }
    }
    const okCount = records.filter((r) => r.ok).length;
    const hitCount = records.filter((r) => r.keyHit).length;
    const latencies = records.map((r) => r.ms).sort((a, b) => a - b);
    console.log(`\nkeys.sop summary: total=${records.length}, valid=${pct(okCount, records.length)}, keyHit=${pct(hitCount, records.length)}, p50=${percentile(latencies, 50).toFixed(1)}ms, p95=${percentile(latencies, 95).toFixed(1)}ms`);
    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({ source, total: records.length, valid: okCount, keyHit: hitCount, records: records.map((r) => ({ ...r.row, ok: r.ok, keyHit: r.keyHit, ms: r.ms, predSop: r.predSop })) }, null, 2));
    }
    return;
  }

  const records = [];
  const goldIssueCounts = new Map();
  const errorClusters = new Map();

  if (workers > 1) {
    const resList = await runWithWorkerPool(rows, { workers, source, knowledgeDir, spellcheck, confidence, tabAgnostic, z3Eval, maxProposals, perTabTopK });
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { predSop, cmp, conf, spellChanged, ms } = resList[i];
      for (const reason of cmp.goldIssueReasons) {
        goldIssueCounts.set(reason, (goldIssueCounts.get(reason) ?? 0) + 1);
      }
      for (const reason of cmp.predErrorReasons) {
        errorClusters.set(reason, (errorClusters.get(reason) ?? 0) + 1);
      }
      records.push({ row, predSop, cmp, conf, spellChanged, ms });
    }
  } else {
    for (const row of rows) {
      const t0 = performance.now();
      const res = source === 'webmeet'
        ? await formaliseFn(row.text, { topK: maxProposals, spellcheck, confidence })
        : await formaliseFn(row.text, {
            ...extractContextFromSop(row.goldSop, verifier),
            tab: tabAgnostic ? null : row.tab,
            ...(row.previous !== undefined && { previous: row.previous }),
            ...(row.clock !== undefined && { clock: row.clock }),
            maxProposals,
            perTabTopK,
            spellcheck,
            confidence,
          });
      const ms = performance.now() - t0;
      const predSop = typeof res === 'string' ? res : (res?.sop ?? res?.circuit ?? '');
      const proposals = res?.proposals ?? [{ sop: predSop }];
      const conf = res?.confidence ?? null;
      const spellChanged = Boolean(res?.spell?.changed);

      const cmp = z3Evaluator
        ? await z3Evaluator.evaluateProposalsZ3({
            text: row.text,
            ...(source !== 'webmeet' && { tab: row.tab }),
            goldSop: row.goldSop,
            goldReferences: row.goldReferences,
            proposals,
          })
        : row.goldReferences || tabAgnostic || proposals.length > 1
        ? compareProposals({
            text: row.text,
            ...(source !== 'webmeet' && { tab: row.tab }),
            goldSop: row.goldSop,
            goldReferences: row.goldReferences,
            proposals,
            verifier,
          })
        : compareCircuits({
            text: row.text,
            ...(source !== 'webmeet' && { tab: row.tab }),
            goldSop: row.goldSop,
            predSop,
            verifier,
          });

      for (const reason of cmp.goldIssueReasons) {
        goldIssueCounts.set(reason, (goldIssueCounts.get(reason) ?? 0) + 1);
      }
      for (const reason of cmp.predErrorReasons) {
        errorClusters.set(reason, (errorClusters.get(reason) ?? 0) + 1);
      }

      const bestPredSop = proposals[cmp.bestProposalIdx]?.sop ?? predSop;
      records.push({ row, predSop: bestPredSop, cmp, conf, spellChanged, ms });

      if (verbose && (cmp.fairCategory === 'pred_wrong' || cmp.fairCategory === 'pred_better_than_gold')) {
        console.log(`\n[${cmp.fairCategory}] (${row.source}) "${row.text}"`);
        if (cmp.goldIssueReasons.length) console.log(`  goldIssues: ${cmp.goldIssueReasons.join(', ')}`);
        if (cmp.predErrorReasons.length) console.log(`  predReasons: ${cmp.predErrorReasons.join(', ')}`);
        console.log(`  PRED:\n${bestPredSop.split('\n').map((l) => '    ' + l).join('\n')}`);
      }
    }
  }

  const groups = new Map();
  for (const t of tabs) {
    const sub = records.filter((r) => r.row.tab === t);
    if (sub.length) groups.set(t, summarizeGroup(sub));
  }
  groups.set('ALL', summarizeGroup(records));

  console.log('\n| Tab | N | Valid | 0-Warn | GoldFlawed | Exact | BetterGold | EffSuccess | Partial | Wrong | CleanGoldExact | Act | Fam | StrictF1 | AliasF1 | p50ms | p95ms |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, g] of groups) {
    console.log(
      `| ${name} | ${g.n} | ${pct(g.predValid, g.n)} | ${pct(g.predZeroWarn, g.n)} | ${pct(g.goldFlawed, g.n)} | ` +
      `${pct(g.exactMatch, g.n)} | ${pct(g.betterThanGold, g.n)} | ${pct(g.effectiveSuccess, g.n)} | ` +
      `${pct(g.partial, g.n)} | ${pct(g.predWrong, g.n)} | ${pct(g.cleanGoldExact, g.cleanGoldN)} | ` +
      `${pct(g.actExact, g.n)} | ${pct(g.targetFamilyExact, g.n)} | ${g.avgStrictF1.toFixed(3)} | ${g.avgAliasF1.toFixed(3)} | ` +
      `${g.p50Ms.toFixed(1)} | ${g.p95Ms.toFixed(1)} |`
    );
  }

  // WebMeet formalisation grades · v1.2 (webmeet-dataset/LEGEND.md)
  const legendCounts = { L0: 0, L1a: 0, L1b: 0, L1c: 0, L1d: 0, L2a: 0, L2b: 0, L2c: 0, L3: 0, L4: 0 };
  let l1cTypoCount = 0;
  let l1cOtherCount = 0;
  for (const r of records) {
    const g = r.cmp.legendGrade;
    if (g && Object.hasOwn(legendCounts, g)) legendCounts[g]++;
    if (g === 'L1c') {
      if (r.cmp.inputHasTypo) l1cTypoCount++;
      else l1cOtherCount++;
    }
  }
  const l2Total = legendCounts.L2a + legendCounts.L2b + legendCounts.L2c;
  const reasonableTotal = legendCounts.L3 + legendCounts.L4;
  console.log('\nWebMeet formalisation grades · v1.2 (LEGEND.md):');
  console.log('| Grade | Meaning | N | % |');
  console.log('|---|---|---:|---:|');
  console.log(`| **L0 – Fail** | No usable reading / invalid SOP / all unread | ${legendCounts.L0} | ${pct(legendCounts.L0, records.length)} |`);
  console.log(`| **L1a – Wrong intent** | Main action, question, or polarity changes | ${legendCounts.L1a} | ${pct(legendCounts.L1a, records.length)} |`);
  console.log(`| **L1b – Wrong target** | Action plausible, wrong object/family/mode | ${legendCounts.L1b} | ${pct(legendCounts.L1b, records.length)} |`);
  console.log(`| **L1c – Wrong detail or role** | Target & action plausible, wrong value/relation/role | ${legendCounts.L1c} | ${pct(legendCounts.L1c, records.length)} |`);
  console.log(`| &nbsp;&nbsp;L1c (typo / spelling) | Caused by misspelled / split / merged input words | ${l1cTypoCount} | ${pct(l1cTypoCount, records.length)} |`);
  console.log(`| &nbsp;&nbsp;L1c (other causes) | Wrong detail, value, relation, or role on clean spelling | ${l1cOtherCount} | ${pct(l1cOtherCount, records.length)} |`);
  console.log(`| **L1d – Invented instruction** | Adds unsupported action/condition/detail | ${legendCounts.L1d} | ${pct(legendCounts.L1d, records.length)} |`);
  console.log(`| **L2 – Incomplete** | Useful meaning, essential part missing (L2a+L2b+L2c) | ${l2Total} | ${pct(l2Total, records.length)} |`);
  console.log(`| &nbsp;&nbsp;L2a | Missing requested action, question, or step | ${legendCounts.L2a} | ${pct(legendCounts.L2a, records.length)} |`);
  console.log(`| &nbsp;&nbsp;L2b | Missing object, endpoint, or reference | ${legendCounts.L2b} | ${pct(legendCounts.L2b, records.length)} |`);
  console.log(`| &nbsp;&nbsp;L2c | Missing value, property, placement, scope, or condition | ${legendCounts.L2c} | ${pct(legendCounts.L2c, records.length)} |`);
  console.log(`| **L3 – Identical to dataset** | Normalized SOP text matches reference | ${legendCounts.L3} | ${pct(legendCounts.L3, records.length)} |`);
  console.log(`| **L4 – Reasonable alternative** | Intent & essential details preserved (alias / Z3>Gold) | ${legendCounts.L4} | ${pct(legendCounts.L4, records.length)} |`);
  console.log(`| **Reasonable total (L3 + L4)** | Combined reasonable readings | **${reasonableTotal}** | **${pct(reasonableTotal, records.length)}** |`);
  if (z3Eval) {
    const mechReasonable = records.filter((r) => ['L3', 'L4'].includes(r.cmp.mechanicalLegendGrade)).length;
    console.log(`| *Mechanical comparator L3 + L4* (baseline) | Strict string/tuple comparator on same proposals | ${mechReasonable} | ${pct(mechReasonable, records.length)} |`);
  }
  if (source !== 'webmeet' && tabAgnostic) {
    const avgProps = records.reduce((s, r) => s + (r.cmp.proposalCount ?? 1), 0) / Math.max(1, records.length);
    const tabHits = records.filter((r) => r.cmp.tabHit).length;
    console.log(`\nTab-agnostic multi-proposal stats: avgProposals=${avgProps.toFixed(2)}, goldTabInProposals=${tabHits}/${records.length} (${pct(tabHits, records.length)})`);
  }

  const attributionCounts = new Map();
  for (const r of records) {
    const a = r.cmp.attribution ?? 'unknown';
    attributionCounts.set(a, (attributionCounts.get(a) ?? 0) + 1);
  }
  if (attributionCounts.size) {
    console.log('\nRoot-cause attribution (mutually exclusive — Gold vs Typo vs Z3 Formaliser):');
    const order = [
      'success_exact',
      'success_z3_better_than_gold',
      'equiv_gold_redundant_id',
      'fail_gold_annotation_flawed',
      'fail_input_typo',
      'fail_z3_zero_req_filler',
      'fail_z3_act_or_mood',
      'fail_z3_family_or_mode',
      'fail_z3_constraints_or_target',
    ];
    for (const k of order) {
      const c = attributionCounts.get(k) ?? 0;
      if (c > 0) console.log(`  ${c}\t(${pct(c, records.length)})\t${k}`);
    }
  }

  if (goldIssueCounts.size) {
    console.log('\nGold annotation defects:');
    for (const [reason, count] of [...goldIssueCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}\t(${pct(count, records.length)})\t${reason}`);
    }
  }

  if (errorClusters.size) {
    console.log('\nTop formaliser discrepancy/error clusters:');
    for (const [reason, count] of [...errorClusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${count}\t(${pct(count, records.length)})\t${reason}`);
    }
  }

  // Confidence & Calibration report when --confidence is enabled
  let confidenceSummary = null;
  if (confidence && records.some((r) => r.conf)) {
    const computeAuroc = (pairs) => {
      const pos = pairs.filter((p) => p.y === 1);
      const neg = pairs.filter((p) => p.y === 0);
      if (!pos.length || !neg.length) return null;
      let wins = 0;
      for (const p of pos) {
        for (const n of neg) {
          if (p.s > n.s) wins += 1;
          else if (p.s === n.s) wins += 0.5;
        }
      }
      return wins / (pos.length * neg.length);
    };

    const withConf = records.filter((r) => r.conf);
    const effPairs = withConf.map((r) => ({
      s: r.conf.score,
      y: r.cmp.fairCategory === 'exact_match' || r.cmp.fairCategory === 'pred_better_than_gold' ? 1 : 0,
    }));
    const notWrongPairs = withConf.map((r) => ({
      s: r.conf.score,
      y: r.cmp.fairCategory !== 'pred_wrong' ? 1 : 0,
    }));
    const aurocEff = computeAuroc(effPairs);
    const aurocNotWrong = computeAuroc(notWrongPairs);
    const brierEff = effPairs.reduce((a, p) => a + (p.s - p.y) ** 2, 0) / Math.max(1, effPairs.length);

    const bandStats = {};
    console.log('\nConfidence calibration by operational band:');
    console.log('| Band | N | Share | MeanScore | EffSuccess | Act+Fam | Wrong | Ambiguous |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const band of ['high', 'medium', 'low', 'abstain']) {
      const sub = withConf.filter((r) => r.conf.band === band);
      const nB = sub.length;
      const meanS = nB ? sub.reduce((a, r) => a + r.conf.score, 0) / nB : 0;
      const effB = sub.filter((r) => r.cmp.fairCategory === 'exact_match' || r.cmp.fairCategory === 'pred_better_than_gold').length;
      const afB = sub.filter((r) => r.cmp.actExact && r.cmp.targetFamilyExact).length;
      const wrongB = sub.filter((r) => r.cmp.fairCategory === 'pred_wrong').length;
      const ambB = sub.filter((r) => r.conf.ambiguous).length;
      bandStats[band] = { n: nB, meanScore: Number(meanS.toFixed(3)), effSuccess: effB, actFam: afB, wrong: wrongB, ambiguous: ambB };
      console.log(
        `| ${band} | ${nB} | ${pct(nB, withConf.length)} | ${meanS.toFixed(3)} | ${pct(effB, nB)} | ${pct(afB, nB)} | ${pct(wrongB, nB)} | ${pct(ambB, nB)} |`,
      );
    }
    const spellEdits = records.filter((r) => r.spellChanged).length;
    console.log(
      `\nConfidence metrics: AUROC(EffSuccess)=${aurocEff?.toFixed(3) ?? 'n/a'}, AUROC(NotWrong)=${aurocNotWrong?.toFixed(3) ?? 'n/a'}, Brier=${brierEff.toFixed(3)}` +
      (spellcheck ? `, spellEdits=${spellEdits} (${pct(spellEdits, records.length)})` : ''),
    );
    confidenceSummary = { aurocEff, aurocNotWrong, brierEff, spellEdits, bandStats };
  }

  if (jsonOut) {
    const sampleExamples = (cat, perTab = 6) => {
      const out = [];
      for (const t of tabs) {
        out.push(
          ...records
            .filter((r) => r.row.tab === t && r.cmp.fairCategory === cat)
            .slice(0, perTab)
            .map((r) => ({
              tab: r.row.tab,
              source: r.row.source,
              text: r.row.text,
              latencyMs: Math.round(r.ms),
              goldIssueReasons: r.cmp.goldIssueReasons,
              referenceIssues: r.cmp.referenceIssues,
              predErrorReasons: r.cmp.predErrorReasons,
              goldSop: r.row.goldReferences?.find(({ column }) => column === r.cmp.bestReferenceColumn)?.sop ?? r.row.goldSop,
              bestReferenceColumn: r.cmp.bestReferenceColumn,
              goldReferences: r.row.goldReferences,
              predSop: r.predSop,
            }))
        );
      }
      return out;
    };

    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          meta: { source, tabs, samplePct, limit, seed, total: records.length },
          summary: Object.fromEntries(groups),
          attributionCounts: Object.fromEntries(attributionCounts),
          referenceIssues: records.filter(({ cmp }) => cmp.referenceIssues?.length).map(({ row, cmp }) => ({
            source: row.source,
            text: row.text,
            issues: cmp.referenceIssues,
          })),
          goldIssueCounts: Object.fromEntries([...goldIssueCounts.entries()].sort((a, b) => b[1] - a[1])),
          topErrorClusters: [...errorClusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
          examples: {
            pred_better_than_gold: sampleExamples('pred_better_than_gold', 6),
            pred_wrong: sampleExamples('pred_wrong', 6),
            pred_partial: sampleExamples('pred_partial', 4),
          },
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote JSON report to ${jsonOut}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
