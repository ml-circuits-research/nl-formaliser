// Honest Symbolic Confidence, Uncertainty & Ambiguity Estimator for nl-formaliser.
// Produces transparent, downstream-actionable confidence scores and concrete ambiguity explanations
// directly from Z3 MaxSMT objectives, Top-1 vs Top-2 margins, check.mjs verification, and Layer 1 spell cost.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unquoteSop, KEY_ALIASES } from './contracts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIDENCE_WEIGHTS = JSON.parse(
  readFileSync(join(HERE, 'confidence-weights.json'), 'utf8'),
);

function sigmoid(x) {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function summarizeCircuit(sop, parse) {
  if (!sop) return { reqs: [], unreads: [] };
  let wires;
  try {
    wires = parse(sop);
  } catch {
    return { reqs: [], unreads: [] };
  }
  const reqMap = new Map();
  const unreads = [];
  for (const w of wires) {
    if (w.type === 'w.request.request') {
      reqMap.set(w.id, {
        act: unquoteSop(w.attrs.act?.[0] ?? ''),
        mode: unquoteSop(w.attrs.mode?.[0] ?? 'none'),
        mood: unquoteSop(w.attrs.mood?.[0] ?? 'do'),
        question: unquoteSop(w.attrs.question?.[0] ?? 'none'),
        family: '',
        tmode: '',
        constraints: [],
      });
    } else if (w.type === 'w.request.target') {
      const ref = String(w.attrs.request?.[0] ?? '').replace(/^\$/, '');
      const r = reqMap.get(ref);
      if (r) {
        r.family = unquoteSop(w.attrs.family?.[0] ?? '');
        r.tmode = unquoteSop(w.attrs.mode?.[0] ?? '');
      }
    } else if (w.type === 'w.request.constraint') {
      const ref = String(w.attrs.request?.[0] ?? '').replace(/^\$/, '');
      const r = reqMap.get(ref);
      if (r) {
        const rawAttr = unquoteSop(w.attrs.attribute?.[0] ?? '');
        const attr = KEY_ALIASES[rawAttr] ?? rawAttr;
        const val = unquoteSop(w.attrs.value?.[0] ?? w.attrs.step?.[0] ?? '');
        r.constraints.push(`${attr}=${val}`);
      }
    } else if (w.type === 'w.request.unread') {
      const t = unquoteSop(w.attrs.text?.[0] ?? '');
      if (t) unreads.push(t);
    }
  }
  return { reqs: [...reqMap.values()], unreads };
}

/**
 * Compute concrete human/downstream-readable differences between Top-1 and Top-2 Z3 circuits.
 */
export function describeAmbiguity(top1Sop, top2Sop, parse) {
  if (!top1Sop || !top2Sop || top1Sop === top2Sop) return [];
  const a = summarizeCircuit(top1Sop, parse);
  const b = summarizeCircuit(top2Sop, parse);
  const diffs = [];

  if (a.reqs.length !== b.reqs.length) {
    diffs.push(`request_count: ${a.reqs.length} vs ${b.reqs.length}`);
  }
  const n = Math.min(a.reqs.length, b.reqs.length);
  for (let i = 0; i < n; i++) {
    const p = n > 1 ? `r${i + 1}.` : '';
    const ra = a.reqs[i];
    const rb = b.reqs[i];
    if (ra.act !== rb.act) diffs.push(`${p}act: ${ra.act} vs ${rb.act}`);
    if (ra.mood !== rb.mood) diffs.push(`${p}mood: ${ra.mood} vs ${rb.mood}`);
    if (ra.family !== rb.family) diffs.push(`${p}family: ${ra.family} vs ${rb.family}`);
    if (ra.tmode !== rb.tmode) diffs.push(`${p}target_mode: ${ra.tmode} vs ${rb.tmode}`);
    if (diffs.length === 0) {
      const ca = ra.constraints.slice().sort().join(', ');
      const cb = rb.constraints.slice().sort().join(', ');
      if (ca !== cb) diffs.push(`${p}constraints: [${ca}] vs [${cb}]`);
    }
  }
  return diffs.slice(0, 4);
}

/**
 * Estimate transparent symbolic confidence, uncertainty band, and concrete ambiguity details.
 *
 * @param {object} params
 * @param {string} params.text - Raw utterance text
 * @param {string} params.sop - Top-1 SOP Lang circuit
 * @param {string[]} [params.alternatives] - Top-2..K SOP circuits
 * @param {number[]} [params.objectives] - Exact Z3 MaxSMT penalty objectives [obj1, obj2, ...]
 * @param {object} [params.checkResult] - Output of `verifier.check(text, sop)`
 * @param {number} [params.contentTokens] - Number of content tokens in utterance
 * @param {object|null} [params.spell] - Optional Layer 1 spellchecker result
 * @param {function} [params.parse] - SOP parser function
 * @param {object} [params.weights] - Optional override for confidence logistic weights
 */
export function estimateConfidence({
  text,
  sop,
  alternatives = [],
  objectives = [],
  checkResult = null,
  contentTokens = null,
  spell = null,
  parse = null,
  weights = DEFAULT_CONFIDENCE_WEIGHTS,
} = {}) {
  const w = { ...DEFAULT_CONFIDENCE_WEIGHTS, ...(weights ?? {}) };
  const bands = w.bands ?? DEFAULT_CONFIDENCE_WEIGHTS.bands;

  // 1. Hard validity gate from check.mjs
  const valid = checkResult ? Boolean(checkResult.ok) : Boolean(sop && sop.trim().length > 0);
  const warnings = checkResult?.warnings ?? [];
  const warningCount = warnings.length;

  // 2. Unread & coverage accounting
  const parsedSummary = parse ? summarizeCircuit(sop, parse) : { reqs: [], unreads: [] };
  const unreadTexts = parsedSummary.unreads;
  const unreadWordCount = unreadTexts.reduce((acc, s) => acc + s.trim().split(/\s+/).filter(Boolean).length, 0);
  const uncoveredWarn = warnings.find((msg) => /words no wire formalizes/i.test(String(msg)));
  const uncoveredEstimate = uncoveredWarn ? Math.max(1, (String(uncoveredWarn).match(/,/g)?.length ?? 0) + 1) : 0;
  const estContent = contentTokens ?? Math.max(1, String(text ?? '').trim().split(/\s+/).filter(Boolean).length);
  const coverage = Math.max(0, Math.min(1, 1 - (unreadWordCount + uncoveredEstimate) / Math.max(1, estContent)));

  // 3. Z3 exact objective & Top-1 vs Top-2 margin
  const z3Objective = typeof objectives?.[0] === 'number' ? objectives[0] : null;
  const z3Obj2 = typeof objectives?.[1] === 'number' ? objectives[1] : null;
  const energyPerToken = z3Objective !== null ? z3Objective / Math.max(1, estContent) : 0;
  const margin = z3Objective !== null && z3Obj2 !== null ? Math.max(0, z3Obj2 - z3Objective) : null;

  // 4. Concrete ambiguity detection
  const ambiguityDetails = parse && alternatives.length > 0 ? describeAmbiguity(sop, alternatives[0], parse) : [];
  const ambiguous = Boolean(margin !== null && margin <= 6 && ambiguityDetails.length > 0);

  // 5. Layer 1 spellchecker signals
  const spellChanged = Boolean(spell?.changed);
  const spellEditCost = Number(spell?.totalEditCost ?? 0);
  const spellMargin = typeof spell?.margin === 'number' ? spell.margin : null;

  // 6. Calibrated logistic score
  let score;
  if (!valid) {
    score = 0;
  } else {
    const marginClamped = margin !== null ? Math.min(20, margin) : 8; // neutral prior when topK=1
    const z =
      w.bias +
      w.wCoverage * coverage +
      w.wUnreadCount * unreadWordCount +
      w.wWarningCount * warningCount +
      w.wEnergyPerTok * energyPerToken +
      w.wMarginClamped * marginClamped +
      w.wAmbiguous * (ambiguous ? 1 : 0) +
      w.wSpellEditCost * spellEditCost;
    score = Number(sigmoid(z).toFixed(4));
  }

  // Operational decision band for downstream layers
  let band;
  if (!valid || (estContent >= 2 && coverage < 0.35) || score < bands.low) {
    band = 'abstain';
  } else if (score >= bands.high && !ambiguous && unreadWordCount === 0) {
    band = 'high';
  } else if (score >= bands.medium) {
    band = 'medium';
  } else {
    band = 'low';
  }

  // Concise concrete explanation for downstream layers / UI
  const reasons = [];
  if (!valid) {
    reasons.push('schema validation failed');
  } else {
    if (unreadWordCount > 0) reasons.push(`${unreadWordCount} word(s) left unread (${unreadTexts.slice(0, 3).map((s) => `"${s}"`).join(', ')})`);
    if (warningCount > 0) reasons.push(`${warningCount} verifier warning(s)`);
    if (ambiguous) reasons.push(`ambiguous (${ambiguityDetails.slice(0, 2).join('; ')}, Δ=${margin})`);
    else if (margin !== null) reasons.push(`clear Z3 margin Δ=${margin}`);
    if (spellChanged) reasons.push(`spellchecker edited input (cost=${spellEditCost})`);
    if (reasons.length === 0) reasons.push('all content grounded, 0 warnings');
  }

  const summary = `${band.toUpperCase()} (${(score * 100).toFixed(0)}%): ${reasons.join('; ')}.`;

  return {
    score,
    band,
    ambiguous,
    ambiguityDetails,
    summary,
    signals: {
      valid,
      coverage: Number(coverage.toFixed(3)),
      contentTokens: estContent,
      unreadCount: unreadWordCount,
      unreadTexts,
      warningCount,
      z3Objective,
      energyPerToken: Number(energyPerToken.toFixed(2)),
      margin,
      spellChanged,
      spellEditCost,
      spellMargin,
    },
  };
}
