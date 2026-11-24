// Z3 MaxSMT Semantic Evaluator for WebMeet formalisation grades · v1.2 (LEGEND.md).
// Encodes request-graph alignment, SOP domain/unit/value equivalences (from sop-knowledge-worlds),
// context-free defensible intent alternatives, and grounded refinement over defective Gold
// directly as an SMT-LIB2 optimization problem solved by Z3!

import { unquoteSop } from '../src/contracts.mjs';
import { createZ3Runner } from '../src/smt/z3-runner.mjs';
import { compareCircuits } from './compare.mjs';

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

function normToken(s) {
  const low = String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return low
    .split('_')
    .map((w) => UK_TO_US.get(w) ?? w)
    .join('_');
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
    ['top_side', 'top'],
    ['bottom_side', 'bottom'],
    ['solid', 'filled'],
    ['outline', 'hollow'],
    ['dotted', 'spotted'],
    ['bar', 'column'],
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
  const a = normToken(attr);
  const idx = a.indexOf('.');
  const sk = idx >= 0 ? a.slice(idx + 1) : a;
  if (['title', 'label', 'heading'].includes(sk)) return 'name';
  if (['duration'].includes(sk)) return 'length';
  if (['ids'].includes(sk)) return 'id';
  if (['position', 'order'].includes(sk)) return 'relation';
  if (['relation_anchor', 'order_anchor'].includes(sk)) return 'anchor';
  if (['bar_width', 'line_width', 'stroke'].includes(sk)) return 'width';
  return sk;
}

function extractVirtualConstraints(req) {
  const list = [];
  for (const c of req.constraints ?? []) {
    list.push({
      short: shortAttr(c.attribute),
      rawAttr: c.attribute ?? '',
      values: (c.values ?? []).map((v) => String(v)),
      unit: c.unit ?? '',
      operator: c.operator ?? 'eq',
      step: c.step ?? 'none',
      want: c.want ?? 'yes',
    });
  }
  // Representational normalization: target.name / target.count / target.ids as virtual constraints so
  // `target.name=Bee` <-> `drawn.name=Bee` and `target.count=6` <-> `drawn.count=6` unify cleanly in Z3!
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

function areConstraintsSemanticallyCompat(gc, pc, uf) {
  if ((gc.want ?? 'yes') !== (pc.want ?? 'yes')) return false;
  if (gc.short !== pc.short) {
    // Allow width/height <-> size when value matches
    if (!(['width', 'height', 'size'].includes(gc.short) && ['width', 'height', 'size'].includes(pc.short))) {
      return false;
    }
  }
  if (gc.operator === 'delta' || pc.operator === 'delta') {
    if (gc.operator !== pc.operator) return false;
    const gDir = gc.step?.includes('less') ? 'less' : 'more';
    const pDir = pc.step?.includes('less') ? 'less' : 'more';
    return gDir === pDir;
  }
  // Unit-aware temporal duration comparison (e.g. 1 hour === 60 minutes)
  if (gc.short === 'length') {
    const gm = toCanonicalMinutes(gc.values[0], gc.unit);
    const pm = toCanonicalMinutes(pc.values[0], pc.unit);
    if (gm !== null && pm !== null && gm === pm) return true;
  }
  if (gc.values.length === 0 && pc.values.length === 0) return true;
  if (gc.values.length === 0 || pc.values.length === 0) return false;

  // Every value in gc has a semantic match in pc (including optional trailing domain head noun like "Work 2 calendar" === "Work 2")
  const stripTrailingDomainHead = (s) => normToken(s).replace(/_(calendar|meeting|event|section|heading|paragraph|chart|graph|diagram|page|room|object|block)$/, '');
  return gc.values.every((gv) =>
    pc.values.some(
      (pv) =>
        normToken(gv) === normToken(pv) ||
        uf.same(gv, pv) ||
        (stripTrailingDomainHead(gv) && stripTrailingDomainHead(gv) === stripTrailingDomainHead(pv)),
    ),
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

function areTargetsSemanticallyCompat(gReq, pReq, uf) {
  const gFam = gReq.target?.family ?? '';
  const pFam = pReq.target?.family ?? '';
  let famCompat = gFam === pFam;
  if (!famCompat) {
    const fams = new Set([gFam, pFam]);
    // Cross-aspect representations within the same tab
    if (
      (fams.has('drawn') && (fams.has('part') || fams.has('page') || fams.has('composition'))) ||
      (fams.has('section') && (fams.has('block') || fams.has('text') || fams.has('inline') || fams.has('document'))) ||
      (fams.has('block') && (fams.has('inline') || fams.has('text'))) ||
      (fams.has('diagram') && (fams.has('node') || fams.has('page') || fams.has('group') || fams.has('chart'))) ||
      (fams.has('node') && (fams.has('link') || fams.has('group'))) ||
      (fams.has('meeting') && (fams.has('calendar') || fams.has('room')))
    ) {
      famCompat = true;
    }
  }
  if (!famCompat) return { famCompat: false, idCompat: false };

  const gIdents = [gReq.target?.sort, gReq.target?.name, ...(gReq.target?.ids ?? [])].filter(Boolean);
  const pIdents = [pReq.target?.sort, pReq.target?.name, ...(pReq.target?.ids ?? [])].filter(Boolean);
  // Also include *.name / *.title / *.id constraints on the request
  for (const c of gReq.constraints ?? []) {
    if (['name', 'id'].includes(shortAttr(c.attribute))) gIdents.push(...(c.values ?? []));
  }
  for (const c of pReq.constraints ?? []) {
    if (['name', 'id'].includes(shortAttr(c.attribute))) pIdents.push(...(c.values ?? []));
  }

  if (gIdents.length === 0) return { famCompat: true, idCompat: true };
  if (pIdents.length === 0) {
    // Context pronoun / implicit target when Gold had a redundant sort/name
    return { famCompat: true, idCompat: false };
  }
  const idCompat = gIdents.some((gi) =>
    pIdents.some((pi) => normToken(gi) === normToken(pi) || uf.same(gi, pi)),
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

    for (let g = 0; g < G; g++) {
      for (let p = 0; p < P; p++) {
        const ic = areIntentsDefensiblyCompat(gReqs[g], pReqs[p], text);
        const tc = areTargetsSemanticallyCompat(gReqs[g], pReqs[p], uf);
        intentCompat[g][p] = ic;
        targetCompat[g][p] = tc;

        // Maximal semantic constraint matching between gVirt[g] (real non-virtual Gold constraints) and pVirt[p]
        const realGC = gVirt[g].filter((c) => !c.virtual);
        const realPC = pVirt[p].filter((c) => !c.virtual);
        const usedP = new Set();
        let matchedG = 0;
        for (const gc of realGC) {
          let found = -1;
          for (let j = 0; j < pVirt[p].length; j++) {
            if (usedP.has(j)) continue;
            if (areConstraintsSemanticallyCompat(gc, pVirt[p][j], uf)) {
              found = j;
              break;
            }
          }
          if (found >= 0) {
            usedP.add(found);
            matchedG++;
          }
        }
        // Check how many realPC are unmatched in gVirt[g]
        let unmatchedRealP = 0;
        for (const pc of realPC) {
          const hit = gVirt[g].some((gc) => areConstraintsSemanticallyCompat(gc, pc, uf));
          if (!hit) unmatchedRealP++;
        }

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

      if (!ic.defensible) {
        hasL1a = true;
      } else if (!tc.famCompat) {
        hasL1b = true;
      } else if (cc.unmatchedG > 0 && cc.unmatchedRealP > 0) {
        // Both missing a Gold constraint AND emitting a different constraint -> wrong detail/role (L1c)
        hasL1c = true;
      } else if (cc.unmatchedRealP > 0 && !goldHasCoverageDefect) {
        // Extra constraint where clean Gold had none -> L1d
        hasL1d = true;
      } else if (!tc.idCompat) {
        hasL2b = true;
      } else if (cc.unmatchedG > 0) {
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
  async function evaluateProposalsZ3({ text, tab, goldSop, proposals }) {
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
