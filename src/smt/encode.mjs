// Declarative Z3 SMT-LIB2 MaxSMT encoder for nl-formaliser.
// Translates an unfiltered lexical lattice + tab schema into SMT-LIB2 constraints over smt/prelude.smt2 and smt/axioms.smt2.
// ALL disambiguation (clause splitting, act/mode/mood, target family/mode/fill/lookup, key_word binding,
// selector-vs-result phase, negation, and unread fallback) is decided globally by Z3.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTS,
  HYP_KINDS,
  DEFAULT_TAB_FAMILY,
  COMPAT_FAMILIES,
  actToSmt,
  modeToSmt,
  moodToSmt,
  questionToSmt,
  detToSmt,
  phaseToSmt,
  wantToSmt,
} from '../contracts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEIGHTS = JSON.parse(readFileSync(join(HERE, 'weights.json'), 'utf8'));

const VALID_ACT_SET = new Set(ACTS);
const TOKEN_RE = /[A-Za-z0-9]+(?:['\u2019][A-Za-z]+)?/g;
const PLACE_SHORT_KEYS = new Set([
  'relation', 'anchor', 'position', 'order', 'order_anchor', 'relation_anchor',
  'direction', 'at', 'x', 'y', 'place', 'edge', 'side', 'distance', 'distanceGrade', 'offset',
  'from', 'to', 'fromX', 'fromY', 'toX', 'toY', 'shift',
]);

const smtOr = (xs) => (xs.length === 0 ? 'false' : xs.length === 1 ? xs[0] : `(or ${xs.join(' ')})`);
const smtAnd = (xs) => (xs.length === 0 ? 'true' : xs.length === 1 ? xs[0] : `(and ${xs.join(' ')})`);

function atMostOne(vars) {
  if (vars.length <= 1) return null;
  if (vars.length === 2) return `(not (and ${vars[0]} ${vars[1]}))`;
  return `((_ at-most 1) ${vars.join(' ')})`;
}

function compatTargetFamilyIds(tab, tabSpec, attrFamily) {
  const table = COMPAT_FAMILIES[tab];
  // Zero-JS new-world fallback: if a future tab isn't in COMPAT_FAMILIES, allow all families on that tab!
  if (!table) return tabSpec.families.map((_, i) => i);
  const ids = [];
  for (let fid = 0; fid < tabSpec.families.length; fid++) {
    const tf = tabSpec.families[fid];
    if (tf === attrFamily || (table[tf] && table[tf].includes(attrFamily))) {
      ids.push(fid);
    }
  }
  if (ids.length === 0) {
    const idx = tabSpec.families.indexOf(attrFamily);
    if (idx >= 0) ids.push(idx);
  }
  return ids;
}

// Check filler purity with the exact same rule as webmeet-dataset/tools/check.mjs line 164-166.
// IMPORTANT: check.mjs only trusts kb.grammar.fillerWords (w.lang.en LEX.filler), NOT extended fillerPhrases!
function fillerHasHiddenContent(ft, kb) {
  if (typeof kb?.isGrammarWord !== 'function' || !kb?.grammar?.fillerWords) return false;
  const lexFiller = kb.grammar.fillerWords;
  let rest = String(ft || '').toLowerCase().replace(/\u2019/g, "'");
  const fillerPhrases = [...lexFiller].filter((x) => x.includes(' '));
  for (const ph of fillerPhrases) rest = rest.replaceAll(ph, ' ');
  const words = rest.match(TOKEN_RE) ?? [];
  return words.some((w) => !kb.isGrammarWord(w) && !lexFiller.has(w));
}

export function encodeProblem(lattice, { kb, previous = null, clock = null, maxRequests = 4, weights = null } = {}) {
  const W = weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS;
  const { tab, tokens, candidates: rawCandidates, hasQuestionMark } = lattice;
  const tabSpec = kb.tabs[tab];
  if (!tabSpec) throw new Error(`Unknown tab: ${tab}`);

  // Skip single-token GRAMMAR and multi-token UNREAD candidates from Z3 variables:
  // - GRAMMAR tokens are non-content and never emit wires.
  // - 1-token UNREAD covers every content token; adjacent unread tokens are merged cleanly in to-sop.mjs.
  const activeCandidates = rawCandidates.filter((c) => {
    if (c.kind === HYP_KINDS.GRAMMAR) return false;
    if (c.kind === HYP_KINDS.UNREAD && c.endTok > c.startTok) return false;
    return true;
  });

  const T = tokens.length;
  const M = activeCandidates.length;
  const F = tabSpec.families.length;
  const K = tabSpec.keyList.length;
  const famToId = new Map(tabSpec.families.map((f, i) => [f, i]));
  const defaultFamId = famToId.get(DEFAULT_TAB_FAMILY[tab] ?? tabSpec.defaultFamily) ?? 0;

  // Identify clause separators and verb positions to compute tight upper bound R.
  const sepToks = new Set();
  const strongClauseSeps = []; // token indices of strong clause splits ("then", "and then", "afterwards", ";", ".")
  for (const c of activeCandidates) {
    if (c.kind === HYP_KINDS.SEP && c.canSplitClause) {
      for (let t = c.startTok; t <= c.endTok; t++) sepToks.add(t);
      if (c.isStrongSplit) {
        const hasBefore = tokens.slice(0, c.startTok).some((tok) => tok.isContent && !tok.isFiller);
        const hasAfter = tokens.slice(c.endTok + 1).some((tok) => tok.isContent && !tok.isFiller);
        if (hasBefore && hasAfter) strongClauseSeps.push({ startTok: c.startTok, endTok: c.endTok, text: c.text });
      }
    }
  }

  // Distinct non-speech predicate start positions
  const predStartToks = new Set(
    activeCandidates
      .filter((c) => c.kind === HYP_KINDS.PREDICATE && (c.licensed ?? []).some((l) => !['greet', 'thank', 'farewell'].includes(l.act)))
      .map((c) => c.startTok)
  );
  // Count plausible clause boundaries: strong seps with content on both sides, OR extra predicates separated by a real SEP!
  // NEVER allow splitting with zero separator between adjacent words (prevents mid-NP splits like "replace Client | delay letter")!
  let plausibleSplits = strongClauseSeps.length;
  const sortedPreds = [...predStartToks].sort((a, b) => a - b);
  for (let i = 1; i < sortedPreds.length; i++) {
    const prevP = sortedPreds[i - 1], curP = sortedPreds[i];
    if (curP - prevP >= 2) {
      let hasSepBetween = false;
      for (let t = prevP + 1; t < curP; t++) if (sepToks.has(t)) { hasSepBetween = true; break; }
      if (hasSepBetween) plausibleSplits = Math.max(plausibleSplits, i);
    }
  }
  const R = T === 0 ? 1 : Math.max(1, Math.min(maxRequests, 1 + plausibleSplits));

  const lines = [];
  const queryVars = [];
  const blockVars = [];
  const semanticBlockVars = [];
  const elided = new Map(); // c.id -> { phase?, want?, kw? }
  const emit = (s) => lines.push(s);

  emit(`; Problem: tab=${tab} T=${T} M=${M} R=${R}`);

  // Collect candidates by kind and build token cover index
  const byKind = Object.fromEntries(Object.values(HYP_KINDS).map((k) => [k, []]));
  const tokCover = Array.from({ length: T }, () => []);
  for (const c of activeCandidates) {
    byKind[c.kind].push(c);
    for (let t = c.startTok; t <= c.endTok && t < T; t++) {
      tokCover[t].push(c);
    }
  }

  const preds = byKind[HYP_KINDS.PREDICATE];
  const keywords = byKind[HYP_KINDS.KEY_WORD];
  const constraints = byKind[HYP_KINDS.CONSTRAINT];
  const negs = byKind[HYP_KINDS.NEG];
  const tSorts = byKind[HYP_KINDS.TARGET_SORT];
  const tFams = byKind[HYP_KINDS.TARGET_FAMILY];
  const tRefs = byKind[HYP_KINDS.TARGET_REF];

  // Index KEY_WORDs by attrName (only attrs that actually have a KEY_WORD in this sentence can be `asked_r`!)
  const kwByAttr = new Map();
  const usedKwAttrIds = new Set();
  for (const k of keywords) {
    for (const a of k.attrs ?? []) {
      if (!kwByAttr.has(a)) kwByAttr.set(a, []);
      kwByAttr.get(a).push(k);
      const aid = tabSpec.attrToId.get(a);
      if (aid !== undefined) usedKwAttrIds.add(aid);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Per-request declarations & core axioms
  // -------------------------------------------------------------------------
  for (let r = 1; r <= R; r++) {
    emit(`(declare-const active_${r} Bool)`);
    emit(`(declare-const act_${r} Act)`);
    emit(`(declare-const amode_${r} ActMode)`);
    emit(`(declare-const mood_${r} Mood)`);
    emit(`(declare-const q_${r} Question)`);
    emit(`(declare-const asked_${r} Int)`);
    emit(`(declare-const fam_${r} Int)`);
    emit(`(declare-const tmode_${r} TargetMode)`);
    emit(`(declare-const tfill_${r} TargetFill)`);
    emit(`(declare-const tdet_${r} Det)`);
    emit(`(declare-const lookup_${r} Bool)`);
    emit(`(declare-const rstart_${r} Int)`);
    emit(`(declare-const rend_${r} Int)`);
    emit(`(declare-const tpos_${r} Int)`);
    emit(`(declare-const ppos_${r} Int)`);
    emit(`(declare-const ident_${r} Bool)`);

    queryVars.push(
      `active_${r}`, `act_${r}`, `amode_${r}`, `mood_${r}`, `q_${r}`, `asked_${r}`,
      `fam_${r}`, `tmode_${r}`, `tfill_${r}`, `tdet_${r}`, `lookup_${r}`,
      `rstart_${r}`, `rend_${r}`, `tpos_${r}`, `ppos_${r}`, `ident_${r}`,
    );
    blockVars.push(`active_${r}`, `act_${r}`, `fam_${r}`, `tmode_${r}`);
    semanticBlockVars.push(`active_${r}`, `act_${r}`, `q_${r}`, `fam_${r}`);

    // Compact domain for asked_r: only -1 or attrIds that actually have a KEY_WORD in this sentence!
    if (usedKwAttrIds.size === 0) {
      emit(`(assert (= asked_${r} (- 1)))`);
    } else {
      const askedDom = [`(= asked_${r} (- 1))`, ...[...usedKwAttrIds].map((id) => `(= asked_${r} ${id})`)];
      emit(`(assert ${smtOr(askedDom)})`);
    }
    emit(`(assert (and (<= 0 fam_${r}) (< fam_${r} ${F})))`);
    emit(`(assert (and (<= (- 1) tpos_${r}) (< tpos_${r} ${Math.max(1, T)})))`);
    emit(`(assert (and (<= (- 1) ppos_${r}) (< ppos_${r} ${Math.max(1, T)})))`);

    if (T > 0) {
      emit(`(assert (=> active_${r} (and (<= 0 rstart_${r}) (<= rstart_${r} rend_${r}) (< rend_${r} ${T}))))`);
    } else {
      emit(`(assert (and (= rstart_${r} 0) (= rend_${r} 0)))`);
    }
    emit(`(assert (=> (not active_${r}) (and (= rstart_${r} 0) (= rend_${r} 0) (= tpos_${r} (- 1)) (= ppos_${r} (- 1)) (= asked_${r} (- 1)) (not lookup_${r}) (not ident_${r}))))`);

    // Core w.request axioms from smt/axioms.smt2
    emit(`(assert (=> active_${r} (valid-act-mode act_${r} amode_${r})))`);
    emit(`(assert (=> active_${r} (valid-mood-act mood_${r} act_${r} q_${r} asked_${r})))`);
    emit(`(assert (=> active_${r} (valid-act-target-mode act_${r} tmode_${r})))`);
    emit(`(assert (=> active_${r} (valid-verbless-act ppos_${r} act_${r})))`);
    emit(`(assert (=> active_${r} (valid-target-fill tmode_${r} tfill_${r} lookup_${r})))`);
    emit(`(assert (=> active_${r} (lookup-law tmode_${r} tfill_${r} ident_${r} lookup_${r})))`);

    // Speech acts (greet/thank/farewell) are fillers in w.request, not standalone tab requests
    emit(`(assert (=> active_${r} (and (not (= act_${r} ACT_GREET)) (not (= act_${r} ACT_THANK)) (not (= act_${r} ACT_FAREWELL)))))`);
  }

  // Allow 0-request pure-filler conversational circuits ("thanks, that works", "no problem, cheers")
  // ONLY when every content token is covered by FILLER; otherwise activate @r1.
  const canBeZeroReq = T > 0 && tokens.every((tok, idx) =>
    !tok.isContent || tokCover[idx].some((c) => c.kind === HYP_KINDS.FILLER)
  );
  if (canBeZeroReq) {
    emit(`(assert-soft active_1 :weight ${W.zeroReqActivate})`);
  } else {
    emit(`(assert active_1)`);
  }
  // Request 1 can NEVER be TM_BOUND (no earlier request in this message created its referent!)
  emit(`(assert (=> active_1 (not (= tmode_1 TM_BOUND))))`);

  for (let r = 1; r < R; r++) {
    emit(`(assert (=> active_${r + 1} active_${r}))`);
    emit(`(assert (=> active_${r + 1} (< rend_${r} rstart_${r + 1})))`);
    emit(`(assert-soft (not (= tmode_${r + 1} TM_BOUND)) :weight ${W.avoidBound})`);

    const splitGuards = [];
    for (const st of sepToks) {
      splitGuards.push(`(and (< rend_${r} ${st}) (< ${st} rstart_${r + 1}))`);
    }
    if (splitGuards.length > 0) {
      emit(`(assert (=> active_${r + 1} ${smtOr(splitGuards)}))`);
    } else {
      emit(`(assert (not active_${r + 1}))`);
    }
  }

  // Strong clause separator penalty:
  // - For strong word separators ("then", "and then", "afterwards"): require predicates on both sides.
  // - For sentence-ending '.' or ';': fire whenever BOTH sides have non-filler content tokens (handles verbless 2nd clauses like ". font bigger" / "; x on top")!
  if (R > 1) {
    for (const sp of strongClauseSeps) {
      const isWordStrongSep = /\b(then|afterwards)\b/i.test(sp.text);
      const isPunctStrongSep = sp.text === '.' || sp.text === ';';
      const hasPredBefore = [...predStartToks].some((pt) => pt < sp.startTok);
      const hasPredAfter = [...predStartToks].some((pt) => pt > sp.endTok);
      const afterNonFillerContent = tokens.slice(sp.endTok + 1).filter((tok) => tok.isContent && !tok.isFiller).length;
      const afterIsOnlyFillerPhrase = activeCandidates.some(
        (c) => c.kind === HYP_KINDS.FILLER && c.startTok <= sp.endTok + 1 && c.endTok >= T - 2
      );
      const shouldSplit =
        (isWordStrongSep && hasPredBefore && hasPredAfter) ||
        (isPunctStrongSep && afterNonFillerContent >= 1 && !afterIsOnlyFillerPhrase);
      if (shouldSplit) {
        for (let r = 1; r <= R; r++) {
          emit(`(assert-soft (not (and active_${r} (< rstart_${r} ${sp.startTok}) (> rend_${r} ${sp.endTok}))) :weight ${W.strongSepNoStraddle})`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Per-candidate declarations & basic ownership rules
  // -------------------------------------------------------------------------
  const outerFillerIds = new Set();
  for (const c of activeCandidates) {
    emit(`(declare-const sel_${c.id} Bool)`);
    emit(`(declare-const own_${c.id} Int)`);
    queryVars.push(`sel_${c.id}`, `own_${c.id}`);
    if (c.kind !== HYP_KINDS.SEP) blockVars.push(`sel_${c.id}`);

    emit(`(assert (and (<= 0 own_${c.id}) (<= own_${c.id} ${R})))`);
    emit(`(assert (=> (not sel_${c.id}) (= own_${c.id} 0)))`);

    const isOuterOnly = c.kind === HYP_KINDS.FILLER || c.kind === HYP_KINDS.SEP;
    if (isOuterOnly) {
      emit(`(assert (= own_${c.id} 0))`);
      // Exact check.mjs filler purity enforcement: filler hiding content words MUST sit strictly outside every request!
      if (c.kind === HYP_KINDS.FILLER && fillerHasHiddenContent(c.text, kb)) {
        outerFillerIds.add(c.id);
        for (let r = 1; r <= R; r++) {
          emit(`(assert (=> (and sel_${c.id} active_${r}) (span-outside-req rstart_${r} rend_${r} ${c.startTok} ${c.endTok})))`);
        }
      }
    } else {
      emit(`(assert (=> sel_${c.id} (>= own_${c.id} 1)))`);
      for (let r = 1; r <= R; r++) {
        emit(`(assert (=> (and sel_${c.id} (= own_${c.id} ${r})) (and active_${r} (span-in-req rstart_${r} rend_${r} ${c.startTok} ${c.endTok}))))`);
      }
    }
  }

  // Pre-compute compatible KEY_WORDs and NEGs for each CONSTRAINT (elide unused Z3 variables!)
  const compatKwsOfConstraint = new Map();
  const constraintsUsingKw = new Map(keywords.map((k) => [k.id, []]));
  const negsTargetingConstraint = new Map(constraints.map((c) => [c.id, []]));

  for (const n of negs) {
    emit(`(declare-const ntgt_${n.id} Int)`);
    queryVars.push(`ntgt_${n.id}`);
    const nearC = constraints.filter((c) => {
      const gap = c.startTok - n.endTok;
      return gap >= 1 && gap <= 4;
    });
    const dom = [`(= ntgt_${n.id} (- 1))`, ...nearC.map((c) => `(= ntgt_${n.id} ${c.id})`)];
    emit(`(assert ${smtOr(dom)})`);
    emit(`(assert (=> (not sel_${n.id}) (= ntgt_${n.id} (- 1))))`);
    for (const c of nearC) negsTargetingConstraint.get(c.id).push(n);
  }

  const phaseExprOf = new Map();
  const wantExprOf = new Map();
  const kwExprOf = new Map();

  for (const c of constraints) {
    const shortKey = c.attribute && c.attribute.includes('.') ? c.attribute.split('.').slice(1).join('.') : '';
    const isSelectorOnly = ['id', 'ids', 'anchor', 'relation_anchor', 'order_anchor', 'behind', 'seat'].includes(shortKey) && c.attribute !== 'part.ids';
    const allowedPh = c.allowedPhases?.length
      ? c.allowedPhases
      : isSelectorOnly
        ? ['selector']
        : ['result', 'selector'];

    const elideRec = {};
    if (allowedPh.length === 1) {
      const fixedPh = phaseToSmt(allowedPh[0]);
      phaseExprOf.set(c.id, fixedPh);
      elideRec.phase = fixedPh;
    } else {
      emit(`(declare-const ph_${c.id} Phase)`);
      queryVars.push(`ph_${c.id}`);
      phaseExprOf.set(c.id, `ph_${c.id}`);
    }

    const negList = negsTargetingConstraint.get(c.id) ?? [];
    const intrinsicWant = wantToSmt(c.want ?? 'yes');
    if (negList.length === 0) {
      wantExprOf.set(c.id, intrinsicWant);
      elideRec.want = intrinsicWant;
    } else {
      emit(`(declare-const wnt_${c.id} Want)`);
      queryVars.push(`wnt_${c.id}`);
      wantExprOf.set(c.id, `wnt_${c.id}`);
      const anyNeg = smtOr(negList.map((n) => `(= ntgt_${n.id} ${c.id})`));
      emit(`(assert (=> (not ${anyNeg}) (= wnt_${c.id} ${intrinsicWant})))`);
      for (const n of negList) {
        emit(`(assert (=> (= ntgt_${n.id} ${c.id}) (and sel_${n.id} sel_${c.id} (= own_${c.id} own_${n.id}) (= wnt_${c.id} ${wantToSmt(n.negWant ?? 'no')}))))`);
      }
    }

    // Compatible non-overlapping KEY_WORD candidates within distance <= 5 tokens, NEVER crossing ';' or '.'!
    const kwList = [];
    if (c.attribute && kwByAttr.has(c.attribute)) {
      for (const k of kwByAttr.get(c.attribute)) {
        const overlaps = !(k.endTok < c.startTok || c.endTok < k.startTok);
        if (overlaps) continue;
        const lo = Math.min(k.endTok, c.endTok);
        const hi = Math.max(k.startTok, c.startTok);
        if (hi - lo > 5) continue;
        let crossesHardPunct = false;
        for (let t = lo + 1; t < hi; t++) {
          if (tokens[t].isPunct && (tokens[t].text === ';' || tokens[t].text === '.')) {
            crossesHardPunct = true;
            break;
          }
        }
        if (crossesHardPunct) continue;
        kwList.push(k);
        constraintsUsingKw.get(k.id).push(c);
      }
    }
    compatKwsOfConstraint.set(c.id, kwList);

    if (kwList.length === 0) {
      kwExprOf.set(c.id, '(- 1)');
      elideRec.kw = -1;
      if (c.requiresKeyWord) emit(`(assert (not sel_${c.id}))`);
    } else {
      emit(`(declare-const kw_${c.id} Int)`);
      queryVars.push(`kw_${c.id}`);
      kwExprOf.set(c.id, `kw_${c.id}`);
      const kwDom = [`(= kw_${c.id} (- 1))`, ...kwList.map((k) => `(= kw_${c.id} ${k.id})`)];
      emit(`(assert ${smtOr(kwDom)})`);
      emit(`(assert (=> (not sel_${c.id}) (= kw_${c.id} (- 1))))`);
      if (c.requiresKeyWord) emit(`(assert (=> sel_${c.id} (>= kw_${c.id} 0)))`);
      const dist1Kws = [];
      const dist2Kws = [];
      for (const k of kwList) {
        emit(`(assert (=> (= kw_${c.id} ${k.id}) (and sel_${c.id} sel_${k.id} (= own_${c.id} own_${k.id}))))`);
        const dist = k.endTok < c.startTok ? c.startTok - k.endTok : k.startTok - c.endTok;
        if (dist === 1) dist1Kws.push(`(= kw_${c.id} ${k.id})`);
        if (dist <= 2) dist2Kws.push(`(= kw_${c.id} ${k.id})`);
      }
      // Single disjunction per distance band (never conflicting per-k soft clauses that penalize selecting c!)
      if (dist1Kws.length > 0) {
        emit(`(assert-soft (=> (and sel_${c.id} (>= kw_${c.id} 0)) ${smtOr(dist1Kws)}) :weight 10)`);
      }
      if (dist2Kws.length > 0 && dist2Kws.length > dist1Kws.length) {
        emit(`(assert-soft (=> (and sel_${c.id} (>= kw_${c.id} 0)) ${smtOr(dist2Kws)}) :weight 5)`);
      }
    }

    if (Object.keys(elideRec).length > 0) elided.set(c.id, elideRec);
  }

  // -------------------------------------------------------------------------
  // 3. Token Non-Overlap & Complete Content Coverage
  // -------------------------------------------------------------------------
  for (let t = 0; t < T; t++) {
    const cov = tokCover[t];
    const selVars = cov.map((c) => `sel_${c.id}`);
    const amo = atMostOne(selVars);
    if (amo) emit(`(assert ${amo})`);

    if (tokens[t].isContent && selVars.length > 0) {
      emit(`(assert ${smtOr(selVars)})`);
    }
  }

  const reqOwned = activeCandidates.filter((c) => c.kind !== HYP_KINDS.FILLER && c.kind !== HYP_KINDS.SEP);
  const argOwned = activeCandidates.filter((c) =>
    c.kind === HYP_KINDS.TARGET_SORT || c.kind === HYP_KINDS.TARGET_FAMILY ||
    c.kind === HYP_KINDS.TARGET_REF || c.kind === HYP_KINDS.CONSTRAINT || c.kind === HYP_KINDS.UNREAD
  );
  for (let r = 1; r <= R; r++) {
    const ownsAny = reqOwned.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`);
    if (ownsAny.length > 0) {
      emit(`(assert (=> active_${r} ${smtOr(ownsAny)}))`);
    }
    // An extra request slot (r > 1) must carry at least one target/constraint/unread OR be a zero-arg act (undo/redo/save/deselect/copy-repeat);
    // and when splitting (active_2), r = 1 must also carry an argument or be a zero-arg act (never an orphan 1-word verb shell!).
    if (argOwned.length > 0) {
      const hasArg = smtOr(argOwned.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`));
      const isZeroArgAct = `(or (= act_${r} ACT_UNDO) (= act_${r} ACT_REDO) (= act_${r} ACT_SAVE) (= act_${r} ACT_DESELECT) (and (= act_${r} ACT_COPY) (= amode_${r} MODE_REPEAT)))`;
      if (r > 1) {
        emit(`(assert (=> active_${r} (or ${hasArg} ${isZeroArgAct})))`);
      } else if (R > 1) {
        emit(`(assert (=> active_2 (or ${hasArg} ${isZeroArgAct})))`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Predicates, Mood, Questions & Keeping-Verb Law
  // -------------------------------------------------------------------------
  for (let r = 1; r <= R; r++) {
    const pInR = preds.map((p) => `(and sel_${p.id} (= own_${p.id} ${r}))`);
    const amo = atMostOne(pInR);
    if (amo) emit(`(assert ${amo})`);

    const anyP = smtOr(pInR);
    emit(`(assert (=> (not ${anyP}) (= ppos_${r} (- 1))))`);
    for (const p of preds) {
      emit(`(assert (=> (and sel_${p.id} (= own_${p.id} ${r})) (= ppos_${r} ${p.startTok})))`);
      const licClauses = [];
      for (const lic of p.licensed ?? []) {
        if (!VALID_ACT_SET.has(lic.act)) continue;
        const parts = [`(= act_${r} ${actToSmt(lic.act)})`];
        if (lic.mode && lic.mode !== 'none') parts.push(`(= amode_${r} ${modeToSmt(lic.mode)})`);
        else parts.push(`(= amode_${r} MODE_NONE)`);
        if (lic.mood) parts.push(`(= mood_${r} ${moodToSmt(lic.mood)})`);
        if (lic.question && lic.question !== 'none') parts.push(`(= q_${r} ${questionToSmt(lic.question)})`);
        licClauses.push(smtAnd(parts));
      }
      if (licClauses.length > 0) {
        emit(`(assert (=> (and sel_${p.id} (= own_${p.id} ${r})) ${smtOr(licClauses)}))`);
      } else {
        emit(`(assert (not (and sel_${p.id} (= own_${p.id} ${r}))))`);
      }

      // Keeping-verb exclusion law (check.mjs line 260):
      // A keeping verb ("keep", "leave", "spare") ONLY acts as `act=remove` when an exclusion cue
      // ("only", "just", "nothing else", "everything else", "rest") or negated selector (W_NO) is present!
      // Otherwise "keep the tick numbers two digits" / "keep the title bold" is `act=change`.
      if ((p.licensed ?? []).some((l) => l.keeping)) {
        const hasExclusionCue = tokens.some((tok) => ['only', 'just', 'else', 'rest', 'except', 'other'].includes(tok.lower));
        const selConsInR = constraints.map(
          (c) => `(and sel_${c.id} (= own_${c.id} ${r}) (= ${phaseExprOf.get(c.id)} PH_SELECTOR))`
        );
        const negSelConsInR = constraints.map(
          (c) => `(and sel_${c.id} (= own_${c.id} ${r}) (= ${phaseExprOf.get(c.id)} PH_SELECTOR) (= ${wantExprOf.get(c.id)} W_NO))`
        );
        if (!hasExclusionCue) {
          if (negSelConsInR.length > 0) {
            emit(`(assert (=> (and sel_${p.id} (= own_${p.id} ${r}) (= act_${r} ACT_REMOVE)) ${smtOr(negSelConsInR)}))`);
          } else {
            emit(`(assert (not (and sel_${p.id} (= own_${p.id} ${r}) (= act_${r} ACT_REMOVE))))`);
          }
        } else if (selConsInR.length > 0) {
          emit(`(assert (=> (and sel_${p.id} (= own_${p.id} ${r}) (= act_${r} ACT_REMOVE) ${smtOr(selConsInR)}) ${smtOr(negSelConsInR)}))`);
        }
      }

      // Clause-edge WH-fronting law (English syntax):
      // Without '?', a WH-word or copula ("where", "which", "who", "when", "what", "how", "is", "are", "do", "does")
      // buried inside a clause (`p.startTok > rstart_r + 1`) is a relative/subordinate clause (e.g. "... keeping everything else where it is",
      // "... which is on the ground floor"), NEVER a main `act=ask` question predicate!
      if (!hasQuestionMark && (p.licensed ?? []).some((l) => l.act === 'ask')
        && /^(what|what's|which|where|when|who|why|how|is|are|was|were|do|does|did)\b/i.test(p.text)) {
        emit(`(assert (=> (and sel_${p.id} (= own_${p.id} ${r}) (= act_${r} ACT_ASK)) (<= ${p.startTok} (+ rstart_${r} 1))))`);
      }

      // Creation verb immediately followed by indefinite article ("make a ...", "create a ...", "add an ...", "build a ...", "write a ...")
      // strongly signals creation (`act=make, tmode=new`) rather than modifying an existing referent!
      const isCreationVerb = (p.licensed ?? []).some((l) => l.act === 'make');
      const nextIsIndef = p.endTok + 1 < T && ['a', 'an'].includes(tokens[p.endTok + 1].lower);
      if (isCreationVerb && nextIsIndef) {
        emit(`(assert-soft (=> (and sel_${p.id} (= own_${p.id} ${r})) (and (= act_${r} ACT_MAKE) (= tmode_${r} TM_NEW))) :weight ${W.creationVerbIndefMakeNew})`);
      }

      // Dynamic `k.actions.marking` alignment in Z3 (Single Source of Truth from SOP k.actions/shards/verbs-*.sop!):
      // When predicate `p` has a declared marking (verb, act, marker, role) AND that marker appears
      // after `p` in the sentence, reward Z3 for selecting the marked `act`!
      if (kb?.markings instanceof Map) {
        const pTok = tokens[p.startTok];
        const verbKeys = pTok?.lemmas ? [p.text.toLowerCase(), ...pTok.lemmas] : [p.text.toLowerCase()];
        const matchedMarkingActs = new Set();
        for (const vk of verbKeys) {
          const mList = kb.markings.get(vk);
          if (!mList) continue;
          for (const mk of mList) {
            if (!VALID_ACT_SET.has(mk.act) || !(p.licensed ?? []).some((l) => l.act === mk.act)) continue;
            // Check if mk.marker appears within 1..8 tokens after p
            const mParts = mk.marker.split(/\s+/);
            for (let j = p.endTok + 1; j <= Math.min(T - mParts.length, p.endTok + 8); j++) {
              let okM = true;
              for (let u = 0; u < mParts.length; u++) {
                if (tokens[j + u]?.lower !== mParts[u]) { okM = false; break; }
              }
              if (okM) {
                matchedMarkingActs.add(mk.act);
                break;
              }
            }
          }
        }
        if (matchedMarkingActs.size === 1) {
          const [onlyAct] = matchedMarkingActs;
          emit(`(assert-soft (=> (and sel_${p.id} (= own_${p.id} ${r})) (= act_${r} ${actToSmt(onlyAct)})) :weight ${W.markingActAlign})`);
        }
      }
    }

    // Without a question predicate, disallow ACT_ASK unless question mark AND no action predicate!
    const askPredsInR = preds
      .filter((p) => (p.licensed ?? []).some((l) => l.act === 'ask'))
      .map((p) => `(and sel_${p.id} (= own_${p.id} ${r}))`);
    if (!hasQuestionMark && askPredsInR.length === 0) {
      emit(`(assert (=> active_${r} (not (= act_${r} ACT_ASK))))`);
    } else if (!hasQuestionMark) {
      emit(`(assert (=> (and active_${r} (= act_${r} ACT_ASK)) ${smtOr(askPredsInR)}))`);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Target Coherence, Family, Position, Identification & Fill
  // -------------------------------------------------------------------------
  const identifyingCands = [
    ...tSorts,
    ...tRefs.filter((ref) => !ref.isPronoun && (ref.name || ref.ids?.length || ref.codeWords || ref.description || ref.countWords)),
  ];

  for (let r = 1; r <= R; r++) {
    const sInR = tSorts.map((s) => `(and sel_${s.id} (= own_${s.id} ${r}))`);
    const fInR = tFams.map((f) => `(and sel_${f.id} (= own_${f.id} ${r}))`);
    const refInR = tRefs.map((x) => `(and sel_${x.id} (= own_${x.id} ${r}))`);
    if (atMostOne(sInR)) emit(`(assert ${atMostOne(sInR)})`);
    if (atMostOne(fInR)) emit(`(assert ${atMostOne(fInR)})`);
    if (atMostOne(refInR)) emit(`(assert ${atMostOne(refInR)})`);

    const idExprs = identifyingCands.map((h) => `(and sel_${h.id} (= own_${h.id} ${r}))`);
    emit(`(assert (= ident_${r} ${smtOr(idExprs)}))`);

    const posSetters = [];
    for (const s of tSorts) {
      const sFams = s.families ?? (s.family ? [s.family] : []);
      const fids = sFams.map((fn) => famToId.get(fn)).filter((id) => id !== undefined);
      if (fids.length > 0) {
        emit(`(assert (=> (and sel_${s.id} (= own_${s.id} ${r})) ${smtOr(fids.map((id) => `(= fam_${r} ${id})`))}))`);
      }
      emit(`(assert (=> (and sel_${s.id} (= own_${s.id} ${r})) (= tpos_${r} ${s.startTok})))`);
      posSetters.push(`(and sel_${s.id} (= own_${s.id} ${r}))`);
      if (s.det && s.det !== 'none') {
        emit(`(assert-soft (=> (and sel_${s.id} (= own_${s.id} ${r})) (= tdet_${r} ${detToSmt(s.det)})) :weight 20)`);
        if (s.det === 'indefinite') {
          emit(`(assert-soft (=> (and sel_${s.id} (= own_${s.id} ${r})) (= tmode_${r} TM_NEW)) :weight 18)`);
        } else if (s.det === 'definite' || s.det === 'demonstrative' || s.det === 'possessive') {
          emit(`(assert-soft (=> (and sel_${s.id} (= own_${s.id} ${r})) (not (= tmode_${r} TM_NEW))) :weight 18)`);
        }
      }
      if (s.quantifier && /^(all|every|both|each)$/i.test(s.quantifier)) {
        emit(`(assert (=> (and sel_${s.id} (= own_${s.id} ${r}) (not (= tmode_${r} TM_NEW))) (= tfill_${r} TF_ALL)))`);
      }
    }

    for (const f of tFams) {
      const fid = famToId.get(f.family);
      if (fid !== undefined) {
        emit(`(assert (=> (and sel_${f.id} (= own_${f.id} ${r})) (= fam_${r} ${fid})))`);
      }
      const noSortInR = sInR.length ? `(not ${smtOr(sInR)})` : 'true';
      emit(`(assert (=> (and sel_${f.id} (= own_${f.id} ${r}) ${noSortInR}) (= tpos_${r} ${f.startTok})))`);
      posSetters.push(`(and sel_${f.id} (= own_${f.id} ${r}))`);
      if (f.det && f.det !== 'none') {
        emit(`(assert-soft (=> (and sel_${f.id} (= own_${f.id} ${r})) (= tdet_${r} ${detToSmt(f.det)})) :weight 16)`);
        if (f.det === 'indefinite') {
          emit(`(assert-soft (=> (and sel_${f.id} (= own_${f.id} ${r})) (= tmode_${r} TM_NEW)) :weight 16)`);
        } else if (f.det === 'definite' || f.det === 'possessive' || f.det === 'demonstrative') {
          emit(`(assert-soft (=> (and sel_${f.id} (= own_${f.id} ${r})) (not (= tmode_${r} TM_NEW))) :weight 16)`);
        }
      }
    }

    for (const ref of tRefs) {
      const fids = (ref.families ?? tabSpec.families).map((fn) => famToId.get(fn)).filter((id) => id !== undefined);
      if (fids.length > 0 && fids.length < F) {
        emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r})) ${smtOr(fids.map((id) => `(= fam_${r} ${id})`))}))`);
      }
      if (ref.isPronoun) {
        emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r})) (and (not (= tmode_${r} TM_NEW)) (= tfill_${r} TF_CONTEXT))))`);
      } else if (ref.fill === 'all') {
        emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r}) (not (= tmode_${r} TM_NEW))) (= tfill_${r} TF_ALL)))`);
      } else if (ref.fill === 'journal_step') {
        emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r})) (and (= tmode_${r} TM_EXISTING) (= tfill_${r} TF_JOURNAL_STEP))))`);
      } else if (ref.fill === 'written') {
        emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r}) (not (= tmode_${r} TM_NEW))) (= tfill_${r} TF_WRITTEN)))`);
        // Bare proper name or code WITHOUT a preceding name-introducer ("called"/"named"/"labelled"/"titled")
        // strongly refers to an EXISTING named object ("place Sri above...", "move Review to...", "enlarge Process...")!
        const hasPrecedingIntro = keywords.some(
          (k) => k.isNameIntro && k.endTok < ref.startTok && (ref.startTok - k.endTok) <= 2
        );
        if (!hasPrecedingIntro && (ref.isProper || ref.isCode)) {
          emit(`(assert-soft (=> (and sel_${ref.id} (= own_${ref.id} ${r})) (not (= tmode_${r} TM_NEW))) :weight 22)`);
        }
        // On a NEW target (TM_NEW), "called/titled/labelled X" specifies a result attribute (*.title/*.name/*.label/*.content),
        // NOT target.name (which identifies an existing referent!).
        const hasNameAttrOnSpan = constraints.some(
          (c) => c.startTok === ref.startTok && c.endTok === ref.endTok && /\.(title|name|label|content)$/.test(c.attribute ?? '')
        );
        if (hasNameAttrOnSpan) {
          emit(`(assert-soft (not (and sel_${ref.id} (= own_${ref.id} ${r}) (= tmode_${r} TM_NEW))) :weight 45)`);
        }
      }
      if (ref.det && ref.det !== 'none') {
        emit(`(assert-soft (=> (and sel_${ref.id} (= own_${ref.id} ${r})) (= tdet_${r} ${detToSmt(ref.det)})) :weight 14)`);
      }
      const noSortOrFam = (sInR.length + fInR.length) ? `(not ${smtOr([...sInR, ...fInR])})` : 'true';
      emit(`(assert (=> (and sel_${ref.id} (= own_${ref.id} ${r}) ${noSortOrFam}) (= tpos_${r} ${ref.startTok})))`);
      posSetters.push(`(and sel_${ref.id} (= own_${ref.id} ${r}))`);
    }

    emit(`(assert (=> (not ${smtOr(posSetters)}) (= tpos_${r} (- 1))))`);

    const writtenRefInR = tRefs.filter((x) => x.fill === 'written').map((x) => `(and sel_${x.id} (= own_${x.id} ${r}))`);
    const allRefInR = [
      ...tRefs.filter((x) => x.fill === 'all'),
      ...tSorts.filter((s) => s.quantifier && /^(all|every|both|each)$/i.test(s.quantifier)),
    ].map((x) => `(and sel_${x.id} (= own_${x.id} ${r}))`);
    const journalRefInR = tRefs.filter((x) => x.fill === 'journal_step').map((x) => `(and sel_${x.id} (= own_${x.id} ${r}))`);

    emit(`(assert (=> (and active_${r} (not (= tmode_${r} TM_NEW)) (not ident_${r}) (not ${smtOr(allRefInR)}) (not ${smtOr(journalRefInR)})) (= tfill_${r} TF_CONTEXT)))`);
    emit(`(assert-soft (=> (and active_${r} (not (= tmode_${r} TM_NEW)) ${smtOr(sInR)} (not ${smtOr(writtenRefInR)}) (not ${smtOr(allRefInR)})) (= tfill_${r} TF_DESCRIPTION)) :weight 15)`);

    emit(`(assert-soft (=> (and active_${r} (= tmode_${r} TM_NEW)) (= tdet_${r} DET_INDEFINITE)) :weight 4)`);
    emit(`(assert-soft (=> (and active_${r} (not (= tmode_${r} TM_NEW))) (= tdet_${r} DET_DEFINITE)) :weight 4)`);

    // Direct-object proximity: target head right after predicate (1..4 tokens) is strongly preferred
    emit(`(assert-soft (=> (and active_${r} (>= ppos_${r} 0) (>= tpos_${r} 0)) (and (> tpos_${r} ppos_${r}) (<= (- tpos_${r} ppos_${r}) 4))) :weight 10)`);
  }

  // -------------------------------------------------------------------------
  // 6. Constraints, Family Coherence, Key-Word Binding, Phase, Act Alignment & Structural Frames
  // -------------------------------------------------------------------------
  const placeConstraints = [];
  const attrOnlyConstraints = [];

  for (const c of constraints) {
    const cFam = c.attrFamily ?? c.family ?? (c.attribute ? c.attribute.split('.')[0] : null);
    const cFamId = cFam ? famToId.get(cFam) : undefined;
    const compatFids = cFam ? compatTargetFamilyIds(tab, tabSpec, cFam) : [];
    const phExpr = phaseExprOf.get(c.id);
    const shortKey = c.attribute && c.attribute.includes('.') ? c.attribute.split('.').slice(1).join('.') : '';

    if (c.on === 'place' || PLACE_SHORT_KEYS.has(shortKey)) {
      placeConstraints.push(c);
    } else if (shortKey !== 'id' && shortKey !== 'ids') {
      attrOnlyConstraints.push(c);
    }

    for (let r = 1; r <= R; r++) {
      if (compatFids.length > 0 && compatFids.length < F) {
        emit(`(assert (=> (and sel_${c.id} (= own_${c.id} ${r})) ${smtOr(compatFids.map((id) => `(= fam_${r} ${id})`))}))`);
      }
      if (cFamId !== undefined) {
        emit(`(assert-soft (=> (and sel_${c.id} (= own_${c.id} ${r})) (= fam_${r} ${cFamId})) :weight 12)`);
      }
      emit(`(assert (=> (and sel_${c.id} (= own_${c.id} ${r})) (phase-new-law tmode_${r} ${c.isAnchor ? 'true' : 'false'} ${phExpr})))`);

      if (phExpr === `ph_${c.id}`) {
        emit(`(assert-soft (=> (and sel_${c.id} (= own_${c.id} ${r}) (not (= tmode_${r} TM_NEW)) (>= tpos_${r} 0) (< ${c.endTok} tpos_${r})) (= ${phExpr} PH_SELECTOR)) :weight 10)`);
        emit(`(assert-soft (=> (and sel_${c.id} (= own_${c.id} ${r}) (not (= tmode_${r} TM_NEW)) (or (< tpos_${r} 0) (> ${c.startTok} tpos_${r}))) (= ${phExpr} PH_RESULT)) :weight 14)`);
      }
    }

    if (c.isAnchor) {
      const relPredecessors = constraints.filter(
        (rel) => rel.needsAnchor && rel.endTok < c.startTok && (c.startTok - rel.endTok) <= 3
      );
      if (relPredecessors.length === 0) {
        emit(`(assert (not sel_${c.id}))`);
      } else {
        emit(`(assert (=> sel_${c.id} ${smtOr(relPredecessors.map((rel) => `(and sel_${rel.id} (= own_${rel.id} own_${c.id}))`))}))`);
      }
    }

    const kws = compatKwsOfConstraint.get(c.id) ?? [];
    if (kws.length > 0) {
      emit(`(assert-soft (=> sel_${c.id} (>= ${kwExprOf.get(c.id)} 0)) :weight 14)`);
    }
  }

  // Act–Constraint Alignment in Z3 (resolves ambiguous verbs like "set"/"put" AND verbless fragments like "stove, please" / "room for 6 called Birch"!)
  const creationHeadCons = constraints.filter((c) => c.attribute === 'chart.type' || c.attribute === 'diagram.kind');
  const deltaConstraints = constraints.filter((c) => c.operator === 'delta');
  for (let r = 1; r <= R; r++) {
    const hasPlaceInR = smtOr(placeConstraints.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`));
    const hasAttrInR = smtOr(attrOnlyConstraints.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`));
    const hasDeltaInR = smtOr(deltaConstraints.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`));
    const hasCreationHeadInR = smtOr([
      ...tSorts.map((s) => `(and sel_${s.id} (= own_${s.id} ${r}))`),
      ...tFams.filter((f) => !['definite', 'possessive', 'demonstrative'].includes(f.det)).map((f) => `(and sel_${f.id} (= own_${f.id} ${r}))`),
      ...creationHeadCons.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`),
    ]);
    // Comparative delta ("shorter hair", "bigger house", "taller bars") presupposes an EXISTING baseline target!
    if (deltaConstraints.length > 0) {
      emit(`(assert-soft (=> (and active_${r} ${hasDeltaInR}) (and (not (= tmode_${r} TM_NEW)) (not (= act_${r} ACT_MAKE)))) :weight ${W.deltaExisting})`);
    }
    const explicitIndefInR = smtOr([
      ...tSorts.filter((s) => s.det === 'indefinite' || (s.count != null && s.det === 'none')).map((s) => `(and sel_${s.id} (= own_${s.id} ${r}))`),
      ...tFams.filter((f) => f.det === 'indefinite' || (f.count != null && f.det === 'none')).map((f) => `(and sel_${f.id} (= own_${f.id} ${r}))`),
      ...tRefs.filter((x) => x.det === 'indefinite').map((x) => `(and sel_${x.id} (= own_${x.id} ${r}))`),
    ]);
    if (placeConstraints.length > 0) {
      emit(`(assert-soft (=> (and active_${r} ${hasPlaceInR} (not ${explicitIndefInR}) (not (= act_${r} ACT_MAKE)) (not (= act_${r} ACT_REMOVE)) (not (= act_${r} ACT_ASK))) (= act_${r} ACT_PLACE)) :weight ${W.placeActAlign})`);
    }
    if (attrOnlyConstraints.length > 0) {
      emit(`(assert-soft (=> (and active_${r} ${hasAttrInR} (not ${hasPlaceInR}) (not (= act_${r} ACT_MAKE)) (not (= act_${r} ACT_REMOVE)) (not (= act_${r} ACT_ASK))) (= act_${r} ACT_CHANGE)) :weight ${W.changeActAlign})`);
    }
    // Direction vs static region disambiguation in Z3:
    // Under ACT_PLACE without static prep ("move the boat left"), prefer *.direction; with "at/on/in" ("on the left"), prefer *.at!
    const dirConsInR = constraints.filter((c) => c.attribute?.endsWith('.direction') && !(c.startTok > 0 && ['at', 'on', 'in'].includes(tokens[c.startTok - 1]?.lower ?? '')));
    const atConsInR = constraints.filter((c) => c.attribute?.endsWith('.at') && !(c.startTok > 0 && ['at', 'on', 'in'].includes(tokens[c.startTok - 1]?.lower ?? '')));
    if (dirConsInR.length > 0 && atConsInR.length > 0) {
      for (const a of atConsInR) {
        emit(`(assert-soft (not (and active_${r} (= act_${r} ACT_PLACE) sel_${a.id} (= own_${a.id} ${r}))) :weight ${W.placeDirOverAt})`);
      }
    }
    // Resultative "make <existing/bare target> <post-target attribute/size/colour>" ("make the house blue", "make face orange", "make cupboard red", "make boat 67 pixels wide")
    // vs creation "make a blue house" / "make a line chart" (explicit indefinite determiner or chart.type/diagram.kind):
    const chartOrDiagHeadInR = smtOr(creationHeadCons.map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`));
    const postTargetPropInR = smtOr(
      attrOnlyConstraints
        .filter((c) => c.attribute !== 'chart.type' && c.attribute !== 'diagram.kind' && !c.attribute?.endsWith('.title') && !c.attribute?.endsWith('.name') && !c.attribute?.endsWith('.content') && !c.attribute?.endsWith('.about') && !c.attribute?.endsWith('.genre'))
        .map((c) => `(and sel_${c.id} (= own_${c.id} ${r}) (>= tpos_${r} 0) (> ${c.startTok} tpos_${r}))`)
    );
    if (attrOnlyConstraints.length > 0) {
      emit(`(assert-soft (=> (and active_${r} (>= ppos_${r} 0) ${postTargetPropInR} (not ${explicitIndefInR}) (not ${chartOrDiagHeadInR}) (or (= act_${r} ACT_MAKE) (= act_${r} ACT_CHANGE))) (and (= act_${r} ACT_CHANGE) (= tmode_${r} TM_EXISTING))) :weight ${W.resultativeMakeToChange})`);
    }

    // Verbless fragment discipline:
    // - Verbless request never invents a finer mode like mode=arrange unless a layout/arrangement constraint is selected!
    const layoutConsInR = smtOr(
      constraints
        .filter((c) => c.attribute?.endsWith('.layout') || c.attribute?.endsWith('.arrangement'))
        .map((c) => `(and sel_${c.id} (= own_${c.id} ${r}))`)
    );
    emit(`(assert (=> (and active_${r} (< ppos_${r} 0) (not ${layoutConsInR})) (= amode_${r} MODE_NONE)))`);
    // - Verbless layout ("a radial for me, Roadmap") -> ACT_PLACE + MODE_ARRANGE!
    emit(`(assert-soft (=> (and active_${r} (< ppos_${r} 0) ${layoutConsInR}) (and (= act_${r} ACT_PLACE) (= amode_${r} MODE_ARRANGE))) :weight 22)`);
    // - Verbless noun/chart/diagram phrase ("stove, please", "room for 6 called Birch", "bar graph, orange...") -> ACT_MAKE (unless delta comparative!)
    // - Verbless property/delta without creation head ("bigger!", "blue") -> ACT_CHANGE; verbless place/direction -> ACT_PLACE!
    emit(`(assert-soft (=> (and active_${r} (< ppos_${r} 0) ${hasCreationHeadInR} (not ${hasDeltaInR})) (= act_${r} ACT_MAKE)) :weight ${W.verblessCreationMake})`);
    emit(`(assert-soft (=> (and active_${r} (< ppos_${r} 0) (not ${hasCreationHeadInR}) ${hasAttrInR} (not ${hasPlaceInR})) (= act_${r} ACT_CHANGE)) :weight ${W.verblessAttrChange})`);
    emit(`(assert-soft (=> (and active_${r} (< ppos_${r} 0) (not ${hasCreationHeadInR}) ${hasPlaceInR}) (= act_${r} ACT_PLACE)) :weight ${W.verblessPlace})`);
  }

  // Every selected KEY_WORD must serve a purpose
  for (const k of keywords) {
    const boundUsers = (constraintsUsingKw.get(k.id) ?? []).map((c) => `(= ${kwExprOf.get(c.id)} ${k.id})`);
    const amoUsers = atMostOne(boundUsers);
    if (amoUsers) emit(`(assert ${amoUsers})`);

    const kAttrIds = (k.attrs ?? []).map((a) => tabSpec.attrToId.get(a)).filter((id) => id !== undefined);
    for (let r = 1; r <= R; r++) {
      const purposes = [...boundUsers];
      if (kAttrIds.length > 0) {
        purposes.push(`(and (= act_${r} ACT_ASK) ${smtOr(kAttrIds.map((id) => `(= asked_${r} ${id})`))})`);
      }
      if (k.isNameIntro) {
        const namedRefs = tRefs
          .filter((ref) => ref.name && ref.startTok > k.endTok && (ref.startTok - k.endTok) <= 3)
          .map((ref) => `(and sel_${ref.id} (= own_${ref.id} ${r}))`);
        if (namedRefs.length > 0) purposes.push(smtOr(namedRefs));
      }
      if (purposes.length === 0) {
        emit(`(assert (not (and sel_${k.id} (= own_${k.id} ${r}))))`);
      } else {
        emit(`(assert (=> (and sel_${k.id} (= own_${k.id} ${r})) ${smtOr(purposes)}))`);
      }
    }
  }

  // If asked_r >= 0 (from usedKwAttrIds only!), some selected KEY_WORD in r must justify asked_r!
  for (let r = 1; r <= R; r++) {
    for (const aid of usedKwAttrIds) {
      const attrName = tabSpec.keyList[aid].name;
      const kws = (kwByAttr.get(attrName) ?? []).map((k) => `(and sel_${k.id} (= own_${k.id} ${r}))`);
      emit(`(assert (=> (and active_${r} (= asked_${r} ${aid})) ${smtOr(kws)}))`);
    }
  }

  // Non-duplication of identical constraints in the same request
  const dupBuckets = new Map();
  for (const c of constraints) {
    const valKey = Array.isArray(c.value) ? c.value.join('\0') : String(c.value ?? '');
    const sig = `${c.attribute ?? ''}|${valKey}|${c.operator ?? ''}|${c.step ?? ''}`;
    if (!dupBuckets.has(sig)) dupBuckets.set(sig, []);
    dupBuckets.get(sig).push(c);
  }
  for (const bucket of dupBuckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i], b = bucket[j];
        emit(`(assert (not (and sel_${a.id} sel_${b.id} (= own_${a.id} own_${b.id}) (= ${phaseExprOf.get(a.id)} ${phaseExprOf.get(b.id)}) (= ${wantExprOf.get(a.id)} ${wantExprOf.get(b.id)}))))`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. MaxSMT Soft Optimization Weights
  // -------------------------------------------------------------------------
  for (const c of activeCandidates) {
    const w = Math.max(0, Math.round(c.cost ?? 0));
    if (w > 0) {
      emit(`(assert-soft (not sel_${c.id}) :weight ${w})`);
    }
  }

  for (let r = 1; r <= R; r++) {
    if (r > 1) {
      emit(`(assert-soft (not active_${r}) :weight ${W.extraRequestPenalty})`);
    }
    emit(`(assert-soft (not lookup_${r}) :weight ${W.lookupPenalty})`);
    // Prefer canonical base act (MODE_NONE) when a verb licenses both MODE_NONE and an optional finer mode (e.g. "set")
    emit(`(assert-soft (=> active_${r} (= amode_${r} MODE_NONE)) :weight ${W.preferModeNone})`);
    emit(`(assert-soft (=> active_${r} (>= ppos_${r} 0)) :weight ${W.preferPredicate})`);
    emit(`(assert-soft (=> (and active_${r} (>= ppos_${r} 0)) (= ppos_${r} rstart_${r})) :weight ${W.preferClauseStartPred})`);
    emit(`(assert-soft (=> active_${r} (= fam_${r} ${defaultFamId})) :weight ${W.defaultFamilyTieBreak})`);
    if (!hasQuestionMark) {
      emit(`(assert-soft (=> active_${r} (= mood_${r} MOOD_DO)) :weight ${W.moodDoNoQ})`);
    } else {
      // Even with a '?', polite "can you / could you / would you" requests are mood=do!
      emit(`(assert-soft (=> active_${r} (= mood_${r} MOOD_DO)) :weight ${W.moodDoWithQ})`);
    }
  }

  // Semantically active closed-class cues (WH question triggers, NEG words, universal quantifiers):
  // Because w.lang.en classifies them as `isGrammar=true`, explicitly reward Z3 for grounding them
  // instead of silently dropping "what's", "how many", "not", "without", "every one", "all"!
  // Note: without '?', bare "when/where/why/how" are often subordinate clauses, and ", which/who/that" after a comma is a RELATIVE clause!
  const STRONG_WH_RE = /^(what's|what is|what are|which|how many|how much|is there|are there|list|count|describe)\b/i;
  const ANY_WH_RE = /^(what|what's|which|where|when|who|why|how|how many|how much|is there|are there|any)\b/i;
  for (const p of preds) {
    const isAskPred = (p.licensed ?? []).some((l) => l.act === 'ask');
    const isSuggestionAbout = /^(how|what)\s+about\b/i.test(p.text) || (/^(how|what)$/i.test(p.text) && tokens[p.endTok + 1]?.lower === 'about');
    const isMedialRelWh = !hasQuestionMark && /^(which|who|where|when|what|how)\b/i.test(p.text)
      && p.startTok > 0 && tokens.slice(0, p.startTok).some((t) => t.isContent && !t.isFiller);
    if (isAskPred && !isSuggestionAbout && !isMedialRelWh && (STRONG_WH_RE.test(p.text) || (hasQuestionMark && ANY_WH_RE.test(p.text)))) {
      emit(`(assert-soft sel_${p.id} :weight 45)`);
    }
  }
  for (const n of negs) {
    emit(`(assert-soft (=> sel_${n.id} (>= ntgt_${n.id} 0)) :weight 20)`);
    emit(`(assert-soft sel_${n.id} :weight 24)`);
  }
  for (const ref of tRefs) {
    if (ref.fill === 'all') {
      emit(`(assert-soft sel_${ref.id} :weight 18)`);
    } else if (ref.isPronoun && /^(it|them|this one|that one|these|those)$/i.test(ref.text)) {
      // Object pronouns ("make it bold", "move it left", "delete them") are isGrammar=true in w.lang.en;
      // reward grounding them when immediately after a verb/predicate so Z3 does not silently drop "it" into mode=new!
      const afterVerb = ref.startTok > 0 && preds.some((p) => p.endTok === ref.startTok - 1);
      if (afterVerb) {
        emit(`(assert-soft sel_${ref.id} :weight 24)`);
      }
    }
  }
  // ACT_CONNECT creates a new link by default when family=link exists on this tab
  const linkFamId = famToId.get('link');
  if (linkFamId !== undefined) {
    for (let r = 1; r <= R; r++) {
      emit(`(assert-soft (=> (and active_${r} (= act_${r} ACT_CONNECT)) (and (= fam_${r} ${linkFamId}) (= tmode_${r} TM_NEW))) :weight ${W.connectLinkNew})`);
    }
  }

  for (const rel of constraints.filter((c) => c.needsAnchor)) {
    const anchors = constraints.filter(
      (a) => a.isAnchor && a.startTok > rel.endTok && (a.startTok - rel.endTok) <= 3
    );
    if (anchors.length > 0) {
      emit(`(assert-soft (=> sel_${rel.id} ${smtOr(anchors.map((a) => `(and sel_${a.id} (= own_${a.id} own_${rel.id}))`))}) :weight 16)`);
    }
  }

  return {
    smtBody: lines.join('\n'),
    queryVars,
    blockVars,
    semanticBlockVars,
    meta: { R, T, M, F, K, tab, tabSpec, previous, clock, elided, activeCandidates, outerFillerIds },
  };
}
