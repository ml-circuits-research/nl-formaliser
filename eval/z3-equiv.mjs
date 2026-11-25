// Z3 MaxSMT Semantic Evaluator for WebMeet formalisation grades · v1.2 (LEGEND.md).
// Encodes request-graph alignment, SOP domain/unit/value equivalences (from sop-knowledge-worlds),
// context-free defensible intent alternatives, and grounded refinement over defective Gold
// directly as an SMT-LIB2 optimization problem solved by Z3!

import { KEY_ALIASES, unquoteSop } from '../src/contracts.mjs';
import { createZ3Runner } from '../src/smt/z3-runner.mjs';
import { lemmatiseWord, singulariseNoun } from '../src/lattice/morph.mjs';
import { compareCircuits, compareRequestIntents, selectReferenceComparison } from './compare.mjs';

const LEGEND_GRADE_RANK = {
  L3: 9,
  L4: 8,
  L2c: 7,
  L2b: 6,
  L2a: 5,
  L1d: 4,
  L1c: 3,
  L1b: 2,
  L1a: 1,
  L0: 0,
};

const UK_TO_US = new Map([
  ['colour', 'color'],
  ['colours', 'colors'],
  ['coloured', 'colored'],
  ['grey', 'gray'],
  ['centre', 'center'],
  ['centred', 'centered'],
  ['labelled', 'labeled'],
  ['modelling', 'modeling'],
  ['organisation', 'organization'],
  ['anticlockwise', 'counterclockwise'],
  ['anti-clockwise', 'counterclockwise'],
  ['counter-clockwise', 'counterclockwise'],
  ['blonde', 'blond'],
  ['checkered', 'checked'],
  ['chequered', 'checked'],
]);

const LEADING_DET_RE = /^(?:the|a|an|my|our|this|that|these|those)_+/;
const TRAILING_DOMAIN_HEAD_RE = /_(?:calendar|meeting|event|section|heading|paragraph|chart|graph|diagram|page|room|object|block|node|there|here)$/;
const TOGGLE_SHORTS = new Set([
  'grid',
  'show_values',
  'legend',
  'stacking',
  'frame',
  'border',
  'shadow',
  'smooth',
  'trend',
  'labels',
]);
const TOGGLE_ON = new Set(['on', 'show', 'true', 'yes', 'visible', 'shown', 'stacked']);
const TOGGLE_OFF = new Set(['off', 'hide', 'false', 'no', 'none', 'hidden', 'unstacked']);

function normToken(s) {
  const unq = unquoteSop(String(s ?? '')).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(unq)) {
    const n = Number(unq);
    if (Number.isFinite(n)) return String(n);
  }
  return unq
    .split('_')
    .filter(Boolean)
    .map((w) => UK_TO_US.get(w) ?? w)
    .join('_');
}

function stripLeadingDet(tok) {
  const s = tok.replace(LEADING_DET_RE, '');
  return s || tok;
}

function lemmaHeadVariants(tok, kb = null) {
  const s = stripLeadingDet(tok);
  const parts = s.split('_').filter(Boolean);
  if (parts.length === 0) return [s];
  const prefix = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const out = new Set([s]);
  if (last.length >= 3 && /^[a-z]+$/.test(last)) {
    for (const cand of [...singulariseNoun(last, kb), ...lemmatiseWord(last, kb)]) {
      const mapped = UK_TO_US.get(cand) ?? cand;
      out.add([...prefix, mapped].join('_'));
    }
  }
  return [...out];
}

function valuesSemanticallyEqual(gv, pv, uf, { allowLemma = true, isToggle = false, kb = null } = {}) {
  const ng = normToken(gv);
  const np = normToken(pv);
  if (!ng && !np) return true;
  if (!ng || !np) return false;
  if (ng === np || uf.same(gv, pv)) return true;

  if (isToggle) {
    if (TOGGLE_ON.has(ng) && TOGGLE_ON.has(np)) return true;
    if (TOGGLE_OFF.has(ng) && TOGGLE_OFF.has(np)) return true;
  }

  const sg = stripLeadingDet(ng);
  const sp = stripLeadingDet(np);
  if (sg === sp || uf.same(sg, sp)) return true;

  const hg = sg.replace(TRAILING_DOMAIN_HEAD_RE, '');
  const hp = sp.replace(TRAILING_DOMAIN_HEAD_RE, '');
  if (hg && hp && (hg === hp || uf.same(hg, hp))) return true;

  if (allowLemma) {
    const gSet = new Set([...lemmaHeadVariants(ng, kb), ...(hg ? lemmaHeadVariants(hg, kb) : [])]);
    const pList = [...lemmaHeadVariants(np, kb), ...(hp ? lemmaHeadVariants(hp, kb) : [])];
    for (const pCand of pList) {
      if (gSet.has(pCand)) return true;
      for (const gCand of gSet) {
        if (uf.same(gCand, pCand)) return true;
      }
    }
  }
  return false;
}

function buildValueUnionFind(kb) {
  const parent = new Map();
  const find = (x) => {
    const k = normToken(x);
    if (!parent.has(k)) parent.set(k, k);
    let root = parent.get(k);
    while (root !== parent.get(root)) root = parent.get(root);
    let cur = k;
    while (cur !== root) {
      const nxt = parent.get(cur);
      parent.set(cur, root);
      cur = nxt;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Seed from k.values core.word equivalence groups (loaded dynamically from sop-knowledge-worlds)
  for (const grp of kb?.domain?.valueEquivGroups ?? []) {
    if (grp.length < 2) continue;
    for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
  }
  // Seed from k.objects.stand_in (e.g. dinghy <-> boat, campfire <-> bonfire)
  for (const [k, v] of kb?.domain?.standIns?.entries?.() ?? []) {
    union(k, v);
  }
  // Seed cardinal number words dynamically from w.lang.en/numbers.sop (e.g. "two" <-> "2")
  for (const [w, info] of kb?.grammar?.numbers?.entries?.() ?? []) {
    const val = typeof info === 'object' ? info?.value : info;
    if (val !== undefined && val !== null && Number.isFinite(Number(val))) {
      union(String(w), String(Number(val)));
    }
  }
  // Standard domain value synonyms in w.request schemas
  for (const [a, b] of [
    ['big', 'large'],
    ['huge', 'very_large'],
    ['giant', 'very_large'],
    ['enormous', 'very_large'],
    ['tiny', 'very_small'],
    ['centre', 'middle'],
    ['center', 'middle'],
    ['left_side', 'left'],
    ['right_side', 'right'],
    ['left_hand_side', 'left'],
    ['right_hand_side', 'right'],
    ['top_side', 'top'],
    ['bottom_side', 'bottom'],
    ['top_edge', 'top'],
    ['bottom_edge', 'bottom'],
    ['left_edge', 'left'],
    ['right_edge', 'right'],
    ['solid', 'filled'],
    ['outline', 'hollow'],
    ['transparent', 'hollow'],
    ['see_through', 'hollow'],
    ['unfilled', 'hollow'],
    ['dotted', 'spotted'],
    ['bar', 'column'],
    ['happy', 'smiling'],
    ['smile', 'smiling'],
    ['sad', 'frowning'],
    ['angry', 'mad'],
  ]) {
    union(a, b);
  }
  return { find, same: (a, b) => Boolean(a && b && find(a) === find(b)) };
}

function toCanonicalMinutes(valStr, unitStr) {
  const num = Number(valStr);
  if (!Number.isFinite(num)) return null;
  const u = normToken(unitStr);
  if (['hour', 'hours', 'hr', 'hrs', 'h'].includes(u)) return Math.round(num * 60);
  if (['minute', 'minutes', 'min', 'mins', 'm'].includes(u)) return Math.round(num);
  // Bare integer <= 6 on meeting.length ("for 1", "length of 3") vs minutes >= 15
  if (!u && num > 0 && num <= 6) return Math.round(num * 60);
  if (!u && num >= 10) return Math.round(num);
  return null;
}

function shortAttr(attr) {
  const raw = String(attr ?? '').trim();
  const aliased = KEY_ALIASES[raw] ?? raw;
  const a = normToken(aliased);
  const idx = a.indexOf('.');
  const sk = idx >= 0 ? a.slice(idx + 1) : a;
  if (['title', 'label', 'heading'].includes(sk)) return 'name';
  if (['duration'].includes(sk)) return 'length';
  if (['ids'].includes(sk)) return 'id';
  if (['position', 'order'].includes(sk)) return 'relation';
  if (['relation_anchor', 'order_anchor'].includes(sk)) return 'anchor';
  if (['bar_width', 'line_width', 'stroke'].includes(sk)) return 'width';
  if (['show_values', 'showvalues', 'valuelabels', 'value_labels'].includes(sk)) return 'show_values';
  if (['showlegend', 'show_legend'].includes(sk)) return 'legend';
  if (['gridlines', 'grid_lines'].includes(sk)) return 'grid';
  if (['stacked'].includes(sk)) return 'stacking';
  if (['side', 'edge'].includes(sk)) return 'at';
  if (sk === 'value' && a.startsWith('part.')) return 'variant';
  return sk;
}

function extractVirtualConstraints(req) {
  const list = [];
  for (const c of req.constraints ?? []) {
    const rawAttr = c.attribute ?? '';
    let short = shortAttr(rawAttr);
    const rawVals =
      (c.values ?? []).length > 0
        ? c.values
        : c.words && c.operator !== 'delta'
          ? [c.words]
          : [];
    let values = rawVals.map((v) => String(v));
    if (rawAttr === 'chart.horizontal') {
      short = 'orientation';
      values = values.map((v) => {
        const nv = normToken(v);
        if (TOGGLE_ON.has(nv) || nv === 'horizontal') return 'horizontal';
        if (TOGGLE_OFF.has(nv) || nv === 'vertical') return 'vertical';
        return v;
      });
    }
    if (short === 'id' && values.length > 1) {
      for (const v of values) {
        list.push({
          short,
          rawAttr,
          values: [v],
          unit: c.unit ?? '',
          operator: c.operator ?? 'eq',
          step: c.step ?? 'none',
          want: c.want ?? 'yes',
        });
      }
      continue;
    }
    list.push({
      short,
      rawAttr,
      values,
      unit: c.unit ?? '',
      operator: c.operator ?? 'eq',
      step: c.step ?? 'none',
      want: c.want ?? 'yes',
    });
  }
  // Representational normalization: target.sort / target.name / target.count / target.ids as virtual constraints so
  // `target.sort=network` <-> `diagram.kind=network`, `target.name=Bee` <-> `drawn.name=Bee`, and `target.count=6` <-> `drawn.count=6` unify cleanly in Z3!
  if (req.target?.sort) {
    list.push({ short: 'kind', rawAttr: 'target.sort', values: [String(req.target.sort)], unit: '', operator: 'eq', step: 'none', want: 'yes', virtual: true });
  }
  for (const fw of req.target?.family_words ?? []) {
    list.push({ short: 'kind', rawAttr: 'target.family_words', values: [String(fw)], unit: '', operator: 'eq', step: 'none', want: 'yes', virtual: true });
  }
  if (req.target?.name) {
    list.push({ short: 'name', rawAttr: 'target.name', values: [String(req.target.name)], unit: '', operator: 'eq', step: 'none', want: 'yes', virtual: true });
  }
  if (req.target?.count != null) {
    list.push({ short: 'count', rawAttr: 'target.count', values: [String(req.target.count)], unit: '', operator: 'eq', step: 'none', want: 'yes', virtual: true });
  }
  for (const id of req.target?.ids ?? []) {
    list.push({ short: 'id', rawAttr: 'target.id', values: [String(id)], unit: '', operator: 'eq', step: 'none', want: 'yes', virtual: true });
  }
  return list;
}

const SIZE_SLOT_GROUP = new Set(['width', 'height', 'size', 'scale']);
const KIND_SLOT_GROUP = new Set(['kind', 'type', 'layout', 'shape', 'preset', 'base', 'genre', 'role']);
const NAME_TEXT_SLOT_GROUP = new Set(['name', 'id', 'content', 'text']);
const TOPIC_SLOT_GROUP = new Set(['about', 'topic', 'scene']);
const LITERAL_SLOTS = new Set(['text', 'content', 'words']);

function areShortSlotsCompat(gs, ps, gc = null, pc = null) {
  if (gs === ps) return true;
  if (SIZE_SLOT_GROUP.has(gs) && SIZE_SLOT_GROUP.has(ps)) return true;
  if (KIND_SLOT_GROUP.has(gs) && KIND_SLOT_GROUP.has(ps)) return true;
  if (NAME_TEXT_SLOT_GROUP.has(gs) && NAME_TEXT_SLOT_GROUP.has(ps)) return true;
  if (TOPIC_SLOT_GROUP.has(gs) && TOPIC_SLOT_GROUP.has(ps)) return true;
  if ((gs === 'id' && pc?.rawAttr === 'target.sort') || (ps === 'id' && gc?.rawAttr === 'target.sort')) return true;
  return false;
}

function areConstraintsSemanticallyCompat(gc, pc, uf, kb = null) {
  if ((gc.want ?? 'yes') !== (pc.want ?? 'yes')) return false;
  if (!areShortSlotsCompat(gc.short, pc.short, gc, pc)) return false;

  if (gc.operator === 'delta' || pc.operator === 'delta') {
    const DELTA_MORE_WORDS = new Set(['bigger', 'larger', 'wider', 'thicker', 'taller', 'longer', 'higher', 'more', 'brighter', 'lighter', 'later', 'clearer']);
    const DELTA_LESS_WORDS = new Set(['smaller', 'tinier', 'narrower', 'thinner', 'shorter', 'lower', 'less', 'darker', 'fainter', 'earlier']);
    const inferDir = (c) => {
      if (c.operator === 'delta') return c.step?.includes('less') ? 'less' : 'more';
      const v0 = normToken(c.values?.[0] ?? '');
      if (DELTA_MORE_WORDS.has(v0)) return 'more';
      if (DELTA_LESS_WORDS.has(v0)) return 'less';
      return null;
    };
    const gDir = inferDir(gc);
    const pDir = inferDir(pc);
    return Boolean(gDir && pDir && gDir === pDir);
  }
  // Unit-aware temporal duration comparison (e.g. 1 hour === 60 minutes)
  if (gc.short === 'length') {
    const gm = toCanonicalMinutes(gc.values[0], gc.unit);
    const pm = toCanonicalMinutes(pc.values[0], pc.unit);
    if (gm !== null && pm !== null && gm === pm) return true;
  }
  if (gc.values.length === 0 && pc.values.length === 0) return true;
  if (gc.values.length === 0 || pc.values.length === 0) return false;

  const allowLemma = !LITERAL_SLOTS.has(gc.short) && !LITERAL_SLOTS.has(pc.short);
  const isToggle = TOGGLE_SHORTS.has(gc.short) || TOGGLE_SHORTS.has(pc.short);

  return gc.values.every((gv) =>
    pc.values.some((pv) => valuesSemanticallyEqual(gv, pv, uf, { allowLemma, isToggle, kb })),
  );
}

const OPPOSING_ACTS = new Set(['remove', 'undo', 'deselect']);

function areIntentsDefensiblyCompat(gReq, pReq, text) {
  const gAct = gReq.act ?? '';
  const pAct = pReq.act ?? '';
  const gMood = gReq.mood ?? 'do';
  const pMood = pReq.mood ?? 'do';

  if (gAct === pAct && gMood === pMood && (gReq.question ?? 'none') === (pReq.question ?? 'none')) {
    return { exact: true, defensible: true };
  }
  // Never equate opposing/destructive acts with constructive/modifying acts!
  if (OPPOSING_ACTS.has(gAct) !== OPPOSING_ACTS.has(pAct)) {
    return { exact: false, defensible: false };
  }
  if (OPPOSING_ACTS.has(gAct) && gAct !== pAct) {
    return { exact: false, defensible: false };
  }

  // Context-free defensible alternatives (LEGEND.md v1.2 lines 14 & 29: text-only without live app state!):
  if (gMood === 'do' && pMood === 'do') {
    const pair = new Set([gAct, pAct]);
    // 1) "put Review on calendar" / "place a tree on the left": make <-> place
    if (pair.has('make') && pair.has('place')) return { exact: false, defensible: true };
    // 2) Without live app state, singleton/feature/verbless specs ("avatar", "add legend", "draw trend line"): make <-> change
    if (pair.has('make') && pair.has('change')) return { exact: false, defensible: true };
    // 3) "I pick a lady for the avatar" / "use woman figure": pick/place <-> change
    if (pair.has('change') && (pair.has('pick') || pair.has('place'))) return { exact: false, defensible: true };
    // 4) "link A to B" / "add an arrow from A to B": connect <-> make
    if (pair.has('connect') && pair.has('make')) return { exact: false, defensible: true };
  }

  // 5) Mixed question + chart/meeting creation ("how do stadiums split by country? a bar chart please", "count of singers per country", "how about an Intro meeting?")
  const acts = new Set([gAct, pAct]);
  if (acts.has('ask') && (acts.has('make') || acts.has('change'))) {
    if (/\b(how|what|which|count|total|average|split)\b/i.test(text)) {
      return { exact: false, defensible: true };
    }
  }

  return { exact: false, defensible: false };
}

function isGroundedInText(idStr, text) {
  const raw = String(idStr ?? '').trim().toLowerCase();
  if (!raw) return false;
  const lowText = String(text ?? '').toLowerCase();
  if (lowText.includes(raw)) return true;
  const norm = raw.replace(/[_\s-]+/g, ' ');
  return Boolean(norm && lowText.includes(norm));
}

function isContrastNegationGrounded(pc, text) {
  if ((pc.want ?? 'yes') !== 'no' || !pc.values?.length) return false;
  const lowText = String(text ?? '').toLowerCase();
  const m = lowText.match(/\b(?:instead of|rather than|without|not)\s+([^.,;!?]+)/);
  if (!m) return false;
  const tail = m[1];
  return pc.values.every((v) => {
    const nv = unquoteSop(String(v)).trim().toLowerCase();
    return nv && (tail.includes(nv) || lemmatiseWord(nv).some((lw) => tail.includes(lw)));
  });
}

function splitContentWords(valStr) {
  const s = stripLeadingDet(normToken(valStr));
  return s.split('_').filter((w) => w && !['the', 'a', 'an', 'of', 'with', 'in', 'on'].includes(w));
}

function areTargetsSemanticallyCompat(gReq, pReq, uf, text, kb = null) {
  const gFam = gReq.target?.family ?? '';
  const pFam = pReq.target?.family ?? '';
  let famCompat = gFam === pFam;
  if (!famCompat) {
    const fams = new Set([gFam, pFam]);
    // Cross-aspect representations within the same tab
    if (
      (fams.has('drawn') && (fams.has('part') || fams.has('page') || fams.has('composition') || fams.has('preference'))) ||
      (fams.has('page') && fams.has('preference')) ||
      (fams.has('section') && (fams.has('block') || fams.has('text') || fams.has('inline') || fams.has('document'))) ||
      (fams.has('block') && (fams.has('inline') || fams.has('text'))) ||
      (fams.has('document') && (fams.has('text') || fams.has('block') || fams.has('inline'))) ||
      (fams.has('diagram') && (fams.has('node') || fams.has('page') || fams.has('group') || fams.has('chart') || fams.has('preference') || fams.has('composition'))) ||
      (fams.has('chart') && (fams.has('group') || fams.has('series') || fams.has('point') || fams.has('page') || fams.has('preference'))) ||
      (fams.has('node') && (fams.has('link') || fams.has('group') || fams.has('point'))) ||
      (fams.has('meeting') && (fams.has('calendar') || fams.has('room')))
    ) {
      famCompat = true;
    }
  }
  if (!famCompat) return { famCompat: false, idCompat: false };

  // Filter out internal live-canvas target IDs (e.g. d1, obj_3) that never appear in text
  const gGroundedIds = (gReq.target?.ids ?? []).filter((id) => isGroundedInText(id, text));
  const gIdents = [gReq.target?.sort, gReq.target?.name, ...gGroundedIds].filter(Boolean);
  const pIdents = [
    pReq.target?.sort,
    pReq.target?.name,
    pReq.target?.description,
    ...(pReq.target?.family_words ?? []),
    ...(pReq.target?.ids ?? []),
  ].filter(Boolean);
  // Also include *.name / *.title / *.id / *.kind / *.type / *.preset / *.shape / *.genre constraints on the request
  const identShorts = new Set(['name', 'id', 'kind', 'type', 'layout', 'preset', 'shape', 'genre']);
  for (const c of gReq.constraints ?? []) {
    const sk = shortAttr(c.attribute);
    if (sk === 'id') {
      gIdents.push(...(c.values ?? []).filter((id) => isGroundedInText(id, text)));
    } else if (identShorts.has(sk)) {
      gIdents.push(...(c.values ?? []));
    }
  }
  for (const c of pReq.constraints ?? []) {
    if (identShorts.has(shortAttr(c.attribute))) pIdents.push(...(c.values ?? []));
  }

  if (gIdents.length === 0) return { famCompat: true, idCompat: true };
  if (pIdents.length === 0) {
    // Context pronoun / implicit target when Gold had a sort/name
    return { famCompat: true, idCompat: false };
  }
  const idCompat = gIdents.some((gi) =>
    pIdents.some((pi) => valuesSemanticallyEqual(gi, pi, uf, { allowLemma: true, kb })),
  );
  return { famCompat: true, idCompat };
}

/**
 * Create a reusable Z3 MaxSMT Semantic Evaluator instance.
 */
export async function createZ3SemanticEvaluator({ kb, verifier, timeoutMs = 1500 } = {}) {
  const runner = await createZ3Runner({ defaultTimeoutMs: timeoutMs });
  const uf = buildValueUnionFind(kb);

  /**
   * Solve semantic alignment between one predicted SOP circuit and the Gold SOP circuit in Z3!
   */
  async function evaluatePairZ3({ text, tab, goldSop, predSop }) {
    const base = compareCircuits({ text, tab, goldSop, predSop, verifier });

    // Fast-path: identical normalized text on clean Gold is always L3!
    if (base.legendGrade === 'L3') {
      return { ...base, z3SemanticGrade: 'L3', z3Used: false };
    }
    // Invalid SOP or completely unread is always L0!
    if (!base.predValid || base.legendGrade === 'L0') {
      return { ...base, z3SemanticGrade: 'L0', z3Used: false };
    }
    // Already L4 under strict mechanical comparator!
    if (base.legendGrade === 'L4') {
      return { ...base, z3SemanticGrade: 'L4', z3Used: false };
    }

    const gReqs = base.goldSummary?.requests ?? [];
    const pReqs = base.predSummary?.requests ?? [];

    // 0-request Gold vs 0-request Pred (both valid pure conversational fillers, e.g. "thanks, that's perfect") -> L4!
    if (gReqs.length === 0 && pReqs.length === 0) {
      return { ...base, legendGrade: 'L4', z3SemanticGrade: 'L4', z3Used: false };
    }
    // 0-request Gold vs >0 Pred: L1d unless Gold had uncovered/bad_filler defect!
    if (gReqs.length === 0 && pReqs.length > 0) {
      const grade = base.goldAnnotationFlawed && base.predZeroWarn ? 'L4' : 'L1d';
      return { ...base, z3SemanticGrade: grade, z3Used: false };
    }
    if (gReqs.length > 0 && pReqs.length === 0) {
      return { ...base, z3SemanticGrade: 'L0', z3Used: false };
    }

    // Build SMT-LIB2 MaxSMT request & constraint alignment model in Z3!
    const G = gReqs.length;
    const P = pReqs.length;
    const gVirt = gReqs.map(extractVirtualConstraints);
    const pVirt = pReqs.map(extractVirtualConstraints);

    const smt = [];
    const qVars = [];
    const emit = (s) => smt.push(s);

    // Request injective mapping: map_g in {-1 .. P-1}
    for (let g = 0; g < G; g++) {
      emit(`(declare-const map_${g} Int)`);
      qVars.push(`map_${g}`);
      emit(`(assert (and (<= (- 1) map_${g}) (< map_${g} ${P})))`);
    }
    for (let g1 = 0; g1 < G; g1++) {
      for (let g2 = g1 + 1; g2 < G; g2++) {
        emit(`(assert (=> (and (>= map_${g1} 0) (>= map_${g2} 0)) (not (= map_${g1} map_${g2}))))`);
      }
    }

    // Precompute compatibility tables & encode Z3 alignment rewards
    const intentCompat = Array.from({ length: G }, () => new Array(P));
    const targetCompat = Array.from({ length: G }, () => new Array(P));
    const consCompatCounts = Array.from({ length: G }, () => new Array(P));
    const requestIntents = Array.from({ length: G }, () => new Array(P));

    for (let g = 0; g < G; g++) {
      for (let p = 0; p < P; p++) {
        const ic = areIntentsDefensiblyCompat(gReqs[g], pReqs[p], text);
        const tc = areTargetsSemanticallyCompat(gReqs[g], pReqs[p], uf, text, kb);
        intentCompat[g][p] = ic;
        targetCompat[g][p] = tc;

        // Ignore ungrounded internal Gold id constraints (e.g. drawn.id=d1 not in text)
        const realGC = gVirt[g].filter(
          (c) => !c.virtual && !(c.short === 'id' && c.values.every((v) => !isGroundedInText(v, text))),
        );
        const realPC = pVirt[p].filter((c) => !c.virtual);
        const usedP = new Set();
        const supportingRealP = new Set();
        const matchedGCIdx = new Set();
        let matchedG = 0;

        for (let gi = 0; gi < realGC.length; gi++) {
          const gc = realGC[gi];
          let found = -1;
          for (let j = 0; j < pVirt[p].length; j++) {
            if (usedP.has(j)) continue;
            if (areConstraintsSemanticallyCompat(gc, pVirt[p][j], uf, kb)) {
              found = j;
              break;
            }
          }
          if (found >= 0) {
            usedP.add(found);
            matchedGCIdx.add(gi);
            matchedG++;
          }
        }

        // Compositional decomposition check: e.g. Gold bundled `wear="the blue cap"` vs Pred `wear=cap` + `color=blue`
        for (let gi = 0; gi < realGC.length; gi++) {
          if (matchedGCIdx.has(gi)) continue;
          const gc = realGC[gi];
          if (gc.values.length !== 1) continue;
          const gWords = splitContentWords(gc.values[0]);
          if (gWords.length < 2) continue;
          const headWord = gWords[gWords.length - 1];
          const headIdx = pVirt[p].findIndex(
            (pc) =>
              areShortSlotsCompat(gc.short, pc.short) &&
              pc.values.some((pv) => valuesSemanticallyEqual(headWord, pv, uf, { allowLemma: true, kb })),
          );
          if (headIdx >= 0) {
            supportingRealP.add(pVirt[p][headIdx]);
            const modWords = gWords.slice(0, -1);
            const allModsCovered = modWords.every((mw) =>
              pVirt[p].some((pc) => {
                const hit = pc.values.some((pv) => valuesSemanticallyEqual(mw, pv, uf, { allowLemma: true, kb }));
                if (hit) supportingRealP.add(pc);
                return hit;
              }),
            );
            if (allModsCovered) {
              matchedGCIdx.add(gi);
              matchedG++;
            }
          }
        }

        // Check how many realPC are unmatched in gVirt[g]
        let unmatchedRealP = 0;
        for (const pc of realPC) {
          if (supportingRealP.has(pc)) continue;
          const directHit = gVirt[g].some((gc) => areConstraintsSemanticallyCompat(gc, pc, uf, kb));
          if (directHit) continue;
          // Symmetric check: Pred bundled `wear="blue cap"` while Gold decomposed `wear=cap` + `color=blue`
          if (pc.values.length === 1) {
            const pWords = splitContentWords(pc.values[0]);
            if (pWords.length >= 2) {
              const allInGold = pWords.every((pw) =>
                gVirt[g].some((gc) => gc.values.some((gv) => valuesSemanticallyEqual(pw, gv, uf, { allowLemma: true, kb }))),
              );
              if (allInGold) continue;
            }
          }
          if (isContrastNegationGrounded(pc, text)) continue;
          // If Gold folded target modifiers into `target.description` (e.g. description="the woman in the green dress and purple hat")
          // and Pred explicitly extracted those target-modifier constraints (`wear=dress`, `wear=hat`), do not penalize as L1d!
          const gDescWords = gReqs[g]?.target?.description ? splitContentWords(gReqs[g].target.description) : [];
          if (
            gDescWords.length >= 2 &&
            pc.values.length > 0 &&
            pc.values.every((pv) => gDescWords.some((dw) => valuesSemanticallyEqual(dw, pv, uf, { allowLemma: true, kb })))
          ) {
            continue;
          }
          unmatchedRealP++;
        }

        const roleDiff = compareRequestIntents(gReqs[g], pReqs[p]);
        requestIntents[g][p] = roleDiff;
        consCompatCounts[g][p] = {
          totalG: realGC.length,
          matchedG,
          unmatchedG: realGC.length - matchedG,
          unmatchedRealP,
        };

        // Z3 MaxSMT objective weights for pairing Gold request g with Pred request p
        let pairScore = 10; // base request match
        if (ic.exact) pairScore += 30;
        else if (ic.defensible) pairScore += 24;
        if (tc.famCompat) pairScore += 20;
        if (tc.idCompat) pairScore += 15;
        pairScore += matchedG * 12;
        pairScore -= (realGC.length - matchedG) * 6;
        if (!base.goldAnnotationFlawed) pairScore -= unmatchedRealP * 5;
        // Request operands can break an alignment tie, but cannot make a
        // different written artifact a better match than the correct owner.
        if (tc.idCompat) {
          const roleScore = roleDiff.tp * 12 - roleDiff.fn * 6 - roleDiff.fp * 5;
          pairScore += Math.max(-10, Math.min(10, roleScore));
        }

        if (pairScore > 0) {
          emit(`(assert-soft (= map_${g} ${p}) :weight ${pairScore})`);
        }
      }
      emit(`(assert-soft (>= map_${g} 0) :weight 15)`);
    }

    const solved = await runner.solve(smt.join('\n'), qVars, { topK: 1, timeout: timeoutMs });
    if (!solved.ok || !solved.solutions?.[0]) {
      return { ...base, z3SemanticGrade: base.legendGrade, z3Used: true };
    }

    const model = solved.solutions[0];
    const mapping = [];
    const matchedPredIdxs = new Set();
    for (let g = 0; g < G; g++) {
      const pIdx = Number(model.get(`map_${g}`) ?? -1);
      mapping.push(pIdx);
      if (pIdx >= 0 && pIdx < P) matchedPredIdxs.add(pIdx);
    }

    // Derive exact LEGEND.md v1.2 grade from Z3's optimal semantic alignment!
    // Remember LEGEND.md priority order: L3, L4, else first error in [L0, L1a, L1b, L1c, L1d, L2a, L2b, L2c].
    const goldHasCoverageDefect =
      base.goldAnnotationFlawed &&
      base.goldIssueReasons.some((r) =>
        ['gold_uncovered_words', 'gold_left_unread', 'gold_bad_filler'].includes(r),
      );

    let hasL1a = false;
    let hasL1b = false;
    let hasL1c = false;
    let hasL1d = false;
    let hasL2a = false;
    let hasL2b = false;
    let hasL2c = false;

    for (let g = 0; g < G; g++) {
      const p = mapping[g];
      if (p < 0 || p >= P) {
        hasL2a = true;
        continue;
      }
      const ic = intentCompat[g][p];
      const tc = targetCompat[g][p];
      const cc = consCompatCounts[g][p];
      const roles = requestIntents[g][p];

      if (!ic.defensible) {
        hasL1a = true;
      } else if (!tc.famCompat || roles.wrongDestination) {
        hasL1b = true;
      } else if ((cc.unmatchedG > 0 && cc.unmatchedRealP > 0) || (roles.fn > 0 && roles.fp > 0)) {
        // Both missing a Gold constraint AND emitting a different constraint -> wrong detail/role (L1c)
        hasL1c = true;
      } else if ((cc.unmatchedRealP > 0 && !goldHasCoverageDefect) || roles.fp > 0) {
        // Extra constraint where clean Gold had none -> L1d
        hasL1d = true;
      } else if (!tc.idCompat || roles.missingDestination) {
        hasL2b = true;
      } else if (cc.unmatchedG > 0 || roles.fn > 0) {
        hasL2c = true;
      }
    }

    // Extra unmatched requests in Pred: L1d unless Gold left part of the utterance uncovered/unread AND Pred grounded it cleanly!
    const extraPredReqs = P - matchedPredIdxs.size;
    if (extraPredReqs > 0 && !(goldHasCoverageDefect && base.predZeroWarn)) {
      hasL1d = true;
    }

    let z3SemanticGrade;
    if (!hasL1a && !hasL1b && !hasL1c && !hasL1d && !hasL2a && !hasL2b && !hasL2c) {
      z3SemanticGrade = 'L4';
    } else if (hasL1a) {
      z3SemanticGrade = 'L1a';
    } else if (hasL1b) {
      z3SemanticGrade = 'L1b';
    } else if (hasL1c) {
      z3SemanticGrade = 'L1c';
    } else if (hasL1d) {
      z3SemanticGrade = 'L1d';
    } else if (hasL2a) {
      z3SemanticGrade = 'L2a';
    } else if (hasL2b) {
      z3SemanticGrade = 'L2b';
    } else {
      z3SemanticGrade = 'L2c';
    }

    return {
      ...base,
      legendGrade: z3SemanticGrade,
      mechanicalLegendGrade: base.legendGrade,
      z3SemanticGrade,
      z3Used: true,
    };
  }

  /**
   * Grade an entire proposal set per LEGEND.md v1.2 using Z3 semantic alignment:
   * Assign L3 if any proposal is L3, else L4 if any proposal is semantically L4 in Z3,
   * else return the closest usable proposal (never assembling fragments!).
   */
  async function evaluateProposalsZ3({ goldReferences, ...options }) {
    if (!goldReferences) return evaluateSingleReferenceZ3(options);
    const references = goldReferences.length ? goldReferences : [{ column: null, sop: '', missing: true }];
    const comparisons = [];
    for (const { column, sop, missing } of references) {
      const result = await evaluateSingleReferenceZ3({ ...options, goldSop: sop });
      comparisons.push({ column, missing, result });
    }
    return selectReferenceComparison(comparisons);
  }

  async function evaluateSingleReferenceZ3({ text, tab, goldSop, proposals }) {
    const list = Array.isArray(proposals) && proposals.length > 0 ? proposals : [{ sop: '', tab }];
    let bestRes = null;
    let bestRank = -1;
    let bestMechRank = -1;
    let bestMechGrade = 'L0';
    let bestProposalIdx = 0;
    let tabHit = false;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const pSop = typeof p === 'string' ? p : (p?.sop ?? '');
      const pTab = typeof p === 'string' ? tab : (p?.tab ?? tab);
      if (pTab === tab) tabHit = true;

      // Cross-tab proposals whose wires are invalid on `tab` cannot match `goldSop` on `tab`
      const evalRes = await evaluatePairZ3({ text, tab, goldSop, predSop: pSop });
      const mGrade = evalRes.mechanicalLegendGrade ?? evalRes.legendGrade;
      const mRank = LEGEND_GRADE_RANK[mGrade] ?? 0;
      if (mRank > bestMechRank) {
        bestMechRank = mRank;
        bestMechGrade = mGrade;
      }
      const rank = LEGEND_GRADE_RANK[evalRes.legendGrade] ?? 0;

      if (
        !bestRes ||
        rank > bestRank ||
        (rank === bestRank && (evalRes.constraintAliasF1?.f1 ?? 0) > (bestRes.constraintAliasF1?.f1 ?? 0))
      ) {
        bestRes = evalRes;
        bestRank = rank;
        bestProposalIdx = i;
      }
    }

    return {
      ...bestRes,
      mechanicalLegendGrade: bestMechGrade,
      proposalCount: list.length,
      bestProposalIdx,
      tabHit,
    };
  }

  return { evaluatePairZ3, evaluateProposalsZ3, runner };
}
