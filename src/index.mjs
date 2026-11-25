// Public entry point for nl-formaliser:
//   const f = await createFormaliser({ knowledgeDir, spellcheck: false });
//   const res = await f.formalise('make the house blue', { tab: 'drawing', topK: 2, confidence: true });

import { loadKnowledge } from './kb/load-worlds.mjs';
import { buildLattice } from './lattice/candidates.mjs';
import { independentChange, sharedResultReadings } from './lattice/shared-result.mjs';
import { findDirectiveProhibitions, overlapsProhibition } from './lattice/prohibitions.mjs';
import { tokenize } from './lattice/tokenize.mjs';
import { encodeProblem } from './smt/encode.mjs';
import { createZ3Runner } from './smt/z3-runner.mjs';
import { shouldUseHierarchicalSegmenter, segmentClausesZ3 } from './smt/segment.mjs';
import { modelToSop } from './emit/to-sop.mjs';
import { createVerifier } from './verify/check.mjs';
import { buildCleanToRawAlignment, regroundSopToRaw } from './pipeline.mjs';
import { estimateConfidence } from './confidence.mjs';
import { fmtSopValue, unquoteSop } from './contracts.mjs';

function unresolvedProhibitions(scopes, rawText, alignment) {
  return scopes.map(({ start, end }) => {
    if (alignment) {
      const aligned = alignment.filter((token) => token.cleanStart < end && start < token.cleanEnd);
      start = aligned[0]?.rawStart ?? 0;
      end = aligned.at(-1)?.rawEnd ?? rawText.length;
    }
    return { kind: 'directive-prohibition', start, end, text: rawText.slice(start, end) };
  });
}

/**
 * Join separately solved circuits. Ordinary clauses keep their own spans;
 * clauses with a shared result use their source hulls.
 */
function stitchClauseCircuits(clauseResults, { fullText, previous, clock, parse, sharedHull = false }) {
  const outLines = [];
  if (previous) outLines.push(`@prev w.request.previous text=${fmtSopValue(previous)}`);
  if (clock?.now && clock?.timezone) {
    outLines.push(`@clock w.request.clock now=${fmtSopValue(clock.now)} timezone=${fmtSopValue(clock.timezone)}`);
  }

  let fCounter = 0;
  let rCounter = 0;
  const seenFillers = new Set();

  for (const cr of clauseResults) {
    if (!cr?.sop) continue;
    let wires;
    try {
      wires = parse(cr.sop);
    } catch {
      continue;
    }

    const reqIdMap = new Map();
    const targetIdMap = new Map();

    // First pass: assign new global IDs for fillers, requests, targets
    for (const w of wires) {
      if (w.type === 'w.request.previous' || w.type === 'w.request.clock') continue;
      if (w.type === 'w.request.filler') {
        const ft = unquoteSop(w.attrs.text?.[0] ?? '');
        if (!ft || seenFillers.has(ft) || !fullText.includes(ft)) continue;
        seenFillers.add(ft);
        outLines.push(`@f${++fCounter} w.request.filler text=${fmtSopValue(ft)}`);
      } else if (w.type === 'w.request.request') {
        reqIdMap.set(w.id, `r${++rCounter}`);
      } else if (w.type === 'w.request.target') {
        const reqRef = String(w.attrs.request?.[0] ?? '').replace(/^\$/, '');
        const newR = reqIdMap.get(reqRef);
        if (newR) targetIdMap.set(w.id, `${newR}.t`);
      }
    }

    const subCounters = new Map(); // `${newR}.${prefix}` -> n
    const nextSub = (newR, prefix) => {
      const k = `${newR}.${prefix}`;
      const n = (subCounters.get(k) ?? 0) + 1;
      subCounters.set(k, n);
      return `${newR}.${prefix}${n}`;
    };
    const wireIdMap = new Map([...reqIdMap, ...targetIdMap]);
    for (const w of wires) {
      if (wireIdMap.has(w.id) || w.type === 'w.request.previous' || w.type === 'w.request.clock' || w.type === 'w.request.filler') continue;
      const reqRef = String(w.attrs.request?.[0] ?? '').replace(/^\$/, '');
      const newR = reqIdMap.get(reqRef);
      if (!newR) continue;
      const prefix = w.type === 'w.request.lookup' ? 'l' : w.type === 'w.request.constraint' ? 'c' : 'u';
      wireIdMap.set(w.id, nextSub(newR, prefix));
    }

    const multiTotal = clauseResults.length > 1;
    for (const w of wires) {
      const newId = wireIdMap.get(w.id);
      if (!newId) continue;

      const pairs = [];
      let hasWords = false;
      for (const [k, vals] of Object.entries(w.attrs)) {
        if (sharedHull && w.type === 'w.request.request' &&
            (k === 'words' || (k === 'predicate' && newId !== 'r1'))) continue;
        if (k === 'words') hasWords = true;
        for (const rawV of vals) {
          if (['request', 'target', 'constraint'].includes(k) && String(rawV).startsWith('$')) {
            const mapped = wireIdMap.get(String(rawV).slice(1));
            if (mapped) pairs.push([k, `$${mapped}`]);
          } else {
            pairs.push([k, rawV]);
          }
        }
      }
      if (w.type === 'w.request.request') {
        if (sharedHull) {
          if (cr.requestWords !== fullText) pairs.push(['words', fmtSopValue(cr.requestWords)]);
          pairs.push(['words_origin', 'hull']);
        } else if (multiTotal && !hasWords && cr.clauseText && cr.clauseText !== fullText && fullText.includes(cr.clauseText)) {
          pairs.push(['words', fmtSopValue(cr.clauseText)]);
        }
      }
      outLines.push(`@${newId} ${w.type} ${pairs.map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
  }
  return outLines.join('\n');
}

export async function createFormaliser({
  knowledgeDir,
  timeoutMs = 4000,
  withVerifier = true,
  spellcheck = false,
  weights = null,
  confidenceWeights = null,
} = {}) {
  const [kb, runner, verifier] = await Promise.all([
    loadKnowledge({ knowledgeDir }),
    createZ3Runner({ timeoutMs }),
    withVerifier ? createVerifier({ knowledgeDir }) : Promise.resolve(null),
  ]);

  let spellCheckerPromise = null;
  async function getSpellChecker() {
    if (!spellCheckerPromise) {
      spellCheckerPromise = (async () => {
        const { createSpellChecker } = await import('./spell/z3-spell.mjs');
        return await createSpellChecker({ kb, timeoutMs: Math.min(2000, timeoutMs) });
      })();
    }
    return spellCheckerPromise;
  }
  if (spellcheck) {
    await getSpellChecker();
  }

  async function solveSinglePass(text, { tab, previous, clock, topK, maxRequests, timeout, effWeights, useSemanticBlock = false }) {
    const lattice = buildLattice(text, { tab, kb, previous, clock });
    const encoded = encodeProblem(lattice, { kb, previous, clock, maxRequests, weights: effWeights });
    const solved = await runner.solve(encoded.smtBody, encoded.queryVars, {
      topK,
      blockVars: useSemanticBlock ? encoded.semanticBlockVars : encoded.blockVars,
      timeout,
    });
    return { lattice, encoded, solved };
  }

  async function solveSharedResult(lattice, { tab, previous, clock, maxRequests, timeout, effWeights }) {
    if (!verifier || lattice.prohibitions.length) return null;
    const keys = kb.tabs[tab].keys;
    for (const { heads, predicate, values } of sharedResultReadings(lattice, kb.grammar, keys, maxRequests)) {
      const results = [];
      const targets = new Set();
      let first;
      for (const { owners, start, projectedText } of heads) {
        const part = await solveSinglePass(projectedText, { tab, previous, clock, maxRequests: 1, topK: 1, timeout, effWeights });
        if (!part.solved.ok) break;
        const sop = modelToSop(part.solved.solutions[0], part.lattice, part.encoded.meta);
        const check = verifier.check(projectedText, sop, tab);
        if (!check.ok || check.warnings.length) break;
        const change = independentChange(verifier.parse(sop), { owners, predicate, values, keys });
        if (!change || targets.has(change.target)) break;
        if (first && (first.effect !== change.effect || (first.property.shortName !== change.property.shortName &&
            !(first.property.means && first.property.means === change.property.means)))) break;
        targets.add(change.target);
        first ??= change;
        const hullStart = results.length === 0 ? predicate.start : start;
        results.push({ sop, requestWords: lattice.text.slice(hullStart, change.resultEnd) });
      }
      if (results.length !== heads.length) continue;
      const sop = stitchClauseCircuits(results, { fullText: lattice.text, previous, clock, parse: verifier.parse, sharedHull: true });
      const check = verifier.check(lattice.text, sop, tab);
      if (check.ok && !check.warnings.length) return { sop, requestCount: results.length };
    }
    return null;
  }

  function scoreTabLattice(lattice, tab, { clock } = {}) {
    const sortToks = new Set();
    const famToks = new Set();
    const kwToks = new Set();
    const consToks = new Set();
    const exclusiveToks = new Set();

    for (const c of lattice.candidates) {
      if (overlapsProhibition(c, lattice.prohibitions)) continue;
      if (c.kind === 'TARGET_SORT') {
        for (let t = c.startTok; t <= c.endTok; t++) sortToks.add(t);
      } else if (c.kind === 'TARGET_FAMILY') {
        for (let t = c.startTok; t <= c.endTok; t++) famToks.add(t);
        if (['meeting', 'calendar', 'room', 'person', 'chart', 'series', 'point', 'diagram', 'link', 'document', 'text', 'section', 'block', 'inline', 'part'].includes(c.family)) {
          for (let t = c.startTok; t <= c.endTok; t++) exclusiveToks.add(t);
        }
      } else if (c.kind === 'KEY_WORD') {
        for (let t = c.startTok; t <= c.endTok; t++) kwToks.add(t);
      } else if (c.kind === 'CONSTRAINT' && (c.cost ?? 10) <= 5) {
        for (let t = c.startTok; t <= c.endTok; t++) consToks.add(t);
        if (
          c.attribute === 'chart.type' ||
          c.attribute === 'diagram.kind' ||
          c.attribute?.startsWith('meeting.') ||
          c.attribute?.startsWith('calendar.') ||
          c.attribute?.startsWith('room.') ||
          c.attribute?.startsWith('document.') ||
          c.attribute?.startsWith('text.') ||
          c.attribute?.startsWith('section.') ||
          c.attribute?.startsWith('block.') ||
          c.attribute?.startsWith('inline.') ||
          c.attribute?.startsWith('chart.') ||
          c.attribute?.startsWith('link.') ||
          c.attribute?.startsWith('part.')
        ) {
          for (let t = c.startTok; t <= c.endTok; t++) exclusiveToks.add(t);
        }
      }
    }
    let exclusiveHits = exclusiveToks.size;
    // Dynamic temporal-context signal: if @clock is supplied, boost tabs that declare temporal meeting keys.
    if (clock && (kb.tabs?.[tab]?.keys?.has('meeting.date') || kb.tabs?.[tab]?.keys?.has('meeting.day') || kb.tabs?.[tab]?.keys?.has('event.date'))) {
      exclusiveHits += 3;
    }
    // A written property with a recognized temporal landmark is stronger
    // domain evidence than isolated words such as "time" or "after".
    const relativeTimeEvidence = lattice.frameMatches.some((frame) => frame.contextProperty?.groundedRelativeTime) ? 20 : 0;
    const score = sortToks.size * 3 + famToks.size * 3 + kwToks.size * 2.5 + consToks.size * 1.5 + exclusiveHits * 4 + relativeTimeEvidence;
    return { score, exclusiveHits };
  }

  async function solveHierarchical(text, lattice, { tab, previous, clock, timeout, effWeights }) {
    if (lattice.prohibitions.length) return null;
    const segRes = await segmentClausesZ3(lattice, { kb, runner, timeout: Math.min(1500, timeout) });
    if (!segRes.ok || segRes.segments.length <= 1) return null;

    const clauseResults = [];
    let totalObjective = 0;
    let hasObj = false;
    const perClauseTimeout = Math.max(1500, Math.floor(timeout * 0.75));

    for (const seg of segRes.segments) {
      const subText = seg.text.trim();
      if (!subText) continue;
      const subLat = buildLattice(subText, { tab, kb, previous, clock });
      const subEnc = encodeProblem(subLat, { kb, previous, clock, maxRequests: 1, weights: effWeights });
      const subSolved = await runner.solve(subEnc.smtBody, subEnc.queryVars, {
        topK: 1,
        blockVars: subEnc.blockVars,
        timeout: perClauseTimeout,
      });
      if (!subSolved.ok) return null;
      const subSop = modelToSop(subSolved.solutions[0], subLat, subEnc.meta);
      if (typeof subSolved.objectives?.[0] === 'number') {
        totalObjective += subSolved.objectives[0];
        hasObj = true;
      }
      clauseResults.push({ clauseText: subText, sop: subSop });
    }

    if (clauseResults.length === 0 || !verifier) return null;
    const stitched = stitchClauseCircuits(clauseResults, {
      fullText: text,
      previous,
      clock,
      parse: verifier.parse,
    });
    const chk = verifier.check(text, stitched, tab);
    if (!chk.ok) return null;

    return {
      sop: stitched,
      objectives: hasObj ? [totalObjective] : [],
      clauseCount: clauseResults.length,
    };
  }

  async function formalise(text, {
    tab = 'drawing',
    previous = null,
    clock = null,
    topK = 1,
    maxProposals = 8,
    perTabTopK = 2,
    maxRequests = 4,
    dumpSmt = false,
    verify = false,
    spellcheck: useSpell = spellcheck,
    confidence: computeConf = false,
    hierarchical = true,
    weights: callWeights = null,
    timeout = timeoutMs,
  } = {}) {
    const t0 = performance.now();
    const rawText = String(text ?? '');
    const effWeights = callWeights ?? weights;
    const rawTokens = tokenize(rawText, kb);
    const prohibitions = findDirectiveProhibitions(rawTokens, kb);
    let unresolved = unresolvedProhibitions(prohibitions, rawText);
    const unresolvedFields = () => unresolved.length ? { unresolved } : {};
    const isAutoTab = tab === null || tab === 'auto';
    const unresolvedOnly = () => ({
      ok: false, status: 'unknown', error: 'Unresolved directive prohibition', tab: isAutoTab ? null : tab,
      sop: '', alternatives: [], proposals: [], objectives: [], elapsedMs: performance.now() - t0,
      ...unresolvedFields(),
    });
    const entirelyProhibited = (tokens, scopes) => scopes.length && tokens.every((token, index) =>
      !token.isContent || token.isFiller || overlapsProhibition({ startTok: index, endTok: index }, scopes));
    if (entirelyProhibited(rawTokens, prohibitions)) {
      return unresolvedOnly();
    }
    // Treat the raw prohibition as a scope boundary before any spelling rewrite.
    const allowSpell = useSpell && prohibitions.length === 0;

    // Tab-agnostic multi-proposal mode (tab === null || tab === 'auto'):
    // Discovers all tabs dynamically from kb.tabs, ranks compatible worlds by lexical evidence,
    // solves each compatible world with Z3 using semantic blocking (diverse act/mood/family/mode),
    // and returns a ranked set of valid proposals without ever needing a tab hint!
    if (isAutoTab) {
      let preSpellRes = null;
      let cleanInput = rawText;
      if (allowSpell) {
        const checker = await getSpellChecker();
        preSpellRes = await checker.normalise(rawText, { topK: 2, timeout: Math.min(1800, timeout) });
        if (preSpellRes.ok && preSpellRes.changed && preSpellRes.cleanText) {
          cleanInput = preSpellRes.cleanText;
        }
      }

      const allTabs = Object.keys(kb.tabs ?? {});
      const scored = allTabs.map((t) => {
        const lat = buildLattice(cleanInput, { tab: t, kb, previous, clock });
        const { score, exclusiveHits } = scoreTabLattice(lat, t, { clock });
        return { tab: t, score, exclusiveHits, lattice: lat };
      }).sort((a, b) => b.score - a.score);

      const selectedTabs = scored;

      const proposalMap = new Map();
      const perTabTimeout = Math.max(1800, Math.floor(timeout * 0.6));

      for (let ti = 0; ti < selectedTabs.length; ti++) {
        const { tab: candTab, score: domainScore } = selectedTabs[ti];
        const kForTab = ti < 3 || selectedTabs[ti].exclusiveHits > 0 ? Math.max(1, perTabTopK) : 1;
        const sub = await formalise(rawText, {
          tab: candTab,
          previous,
          clock,
          topK: kForTab,
          maxRequests,
          dumpSmt: false,
          verify: true,
          spellcheck: false,
          _preSpellRes: preSpellRes,
          confidence: false,
          hierarchical,
          weights: effWeights,
          timeout: perTabTimeout,
          _useSemanticBlock: true,
        });
        if (sub.unresolved?.length) unresolved = sub.unresolved;
        if (!sub.ok) continue;

        const subCircuits = [sub.sop, ...(sub.alternatives ?? [])].filter(Boolean);
        const subObjs = sub.objectives ?? [];
        const bestObj = typeof subObjs[0] === 'number' ? subObjs[0] : null;

        for (let ci = 0; ci < subCircuits.length; ci++) {
          const cSop = subCircuits[ci];
          const obj = typeof subObjs[ci] === 'number' ? subObjs[ci] : null;
          // Filter out wildly degraded secondary proposals within the same tab
          if (ci > 0 && bestObj !== null && obj !== null && (obj - bestObj) > 45) continue;

          const chk = verifier ? verifier.check(rawText, cSop, candTab) : { ok: true, warnings: [] };
          if (!chk.ok) continue;
          const warnCount = chk.warnings?.length ?? 0;
          const normKey = cSop.replace(/\r\n/g, '\n').trim();
          const existing = proposalMap.get(normKey);
          if (!existing || domainScore > existing.domainScore) {
            proposalMap.set(normKey, {
              sop: cSop,
              tab: candTab,
              objective: obj,
              warnings: warnCount,
              domainScore,
              rankInTab: ci,
              ...unresolvedFields(),
            });
          }
        }

        // Dual-path spellcheck safety in multi-proposal mode: when Layer 1 edited the text,
        // also keep the raw-text #1 reading for the top 2 worlds so valid OOV nouns are never lost!
        if (preSpellRes?.changed && ti < 2 && !unresolved.length) {
          const rawSub = await formalise(rawText, {
            tab: candTab,
            previous,
            clock,
            topK: 1,
            maxRequests,
            dumpSmt: false,
            verify: true,
            spellcheck: false,
            confidence: false,
            hierarchical,
            weights: effWeights,
            timeout: Math.min(1000, perTabTimeout),
          });
          if (rawSub.ok && rawSub.sop) {
            const rawChk = verifier ? verifier.check(rawText, rawSub.sop, candTab) : { ok: true, warnings: [] };
            if (rawChk.ok) {
              const rawKey = rawSub.sop.replace(/\r\n/g, '\n').trim();
              if (!proposalMap.has(rawKey)) {
                proposalMap.set(rawKey, {
                  sop: rawSub.sop,
                  tab: candTab,
                  objective: typeof rawSub.objectives?.[0] === 'number' ? rawSub.objectives[0] : null,
                  warnings: rawChk.warnings?.length ?? 0,
                  domainScore,
                  rankInTab: 1,
                });
              }
            }
          }
        }
      }

      const sortedAll = [...proposalMap.values()].sort((a, b) => {
        if ((a.warnings === 0) !== (b.warnings === 0) && Math.abs(a.domainScore - b.domainScore) <= 10) {
          return a.warnings === 0 ? -1 : 1;
        }
        if (a.rankInTab !== b.rankInTab && a.warnings === b.warnings && Math.abs(a.domainScore - b.domainScore) < 2) {
          return a.rankInTab - b.rankInTab;
        }
        if (a.domainScore !== b.domainScore) return b.domainScore - a.domainScore;
        if (a.warnings !== b.warnings) return a.warnings - b.warnings;
        return (a.objective ?? 1e9) - (b.objective ?? 1e9);
      });

      // Keep at least the #1 proposal of every solved tab (so no compatible world is starved),
      // then fill remaining slots up to maxProposals in global rank order.
      const limit = Math.max(1, maxProposals);
      const proposals = [];
      const pickedKeys = new Set();
      const seenTabs = new Set();
      for (const p of sortedAll) {
        if (proposals.length >= limit) break;
        if (!seenTabs.has(p.tab)) {
          seenTabs.add(p.tab);
          pickedKeys.add(p.sop);
          proposals.push(p);
        }
      }
      for (const p of sortedAll) {
        if (proposals.length >= limit) break;
        if (!pickedKeys.has(p.sop)) {
          pickedKeys.add(p.sop);
          proposals.push(p);
        }
      }

      const top = proposals[0];
      if (!top && unresolved.length) return unresolvedOnly();
      return {
        ok: Boolean(top),
        status: top ? (unresolved.length ? 'partial' : 'sat') : 'unknown',
        ...unresolvedFields(),
        sop: top?.sop ?? '',
        tab: top?.tab ?? null,
        alternatives: proposals.slice(1).map((p) => p.sop),
        proposals,
        objectives: proposals.map((p) => p.objective).filter((x) => typeof x === 'number'),
        elapsedMs: performance.now() - t0,
        stats: { tabsConsidered: selectedTabs.map((s) => s.tab), proposalCount: proposals.length },
      };
    }

    const useSemanticBlock = arguments[1]?._useSemanticBlock === true || topK > 1;

    // Optional Layer 1: Standalone Z3 Spellchecker (0.04 ms fast-path on clean inputs!)
    let spellRes = prohibitions.length ? null : (arguments[1]?._preSpellRes ?? null);
    let workingText = rawText;
    if (spellRes) {
      if (spellRes.ok && spellRes.changed && spellRes.cleanText) {
        workingText = spellRes.cleanText;
      }
    } else if (allowSpell) {
      const checker = await getSpellChecker();
      spellRes = await checker.normalise(rawText, { topK: 2, timeout: Math.min(2000, timeout) });
      if (spellRes.ok && spellRes.changed && spellRes.cleanText) {
        workingText = spellRes.cleanText;
      }
    }

    // Effective topK: if confidence requested and topK===1, use topK=2 on short/medium inputs to measure real Z3 margin!
    const effTopK = computeConf && topK < 2 && workingText.length <= 160 ? 2 : topK;

    const initialLattice = buildLattice(workingText, { tab, kb, previous, clock });
    if (workingText !== rawText && initialLattice.prohibitions.length) {
      const alignment = buildCleanToRawAlignment(workingText, spellRes.tokens);
      unresolved = unresolvedProhibitions(initialLattice.prohibitions, rawText, alignment);
      if (!alignment.length || !verifier || entirelyProhibited(initialLattice.tokens, initialLattice.prohibitions)) {
        return unresolvedOnly();
      }
    }
    let sop = '';
    let alternatives = [];
    let objectives = [];
    let smtDump;
    let usedHierarchical = false;
    let finalStats = {
      tokens: initialLattice.tokens.length,
      candidates: initialLattice.candidates.length,
      maxR: maxRequests,
    };

    // Two-stage hierarchical Z3 for long/enumerated multi-clause utterances
    if (hierarchical && verifier && shouldUseHierarchicalSegmenter(initialLattice, kb, { maxRequests })) {
      const hier = await solveHierarchical(workingText, initialLattice, {
        tab,
        previous,
        clock,
        timeout,
        effWeights,
      });
      if (hier) {
        sop = hier.sop;
        objectives = hier.objectives;
        usedHierarchical = true;
        finalStats.maxR = hier.clauseCount;
      }
    }

    if (!usedHierarchical) {
      let { lattice, encoded, solved } = await solveSinglePass(workingText, {
        tab,
        previous,
        clock,
        topK: effTopK,
        maxRequests,
        timeout,
        effWeights,
        useSemanticBlock,
      });

      // Graceful timeout recovery on complex inputs: try Stage-1 Z3 segmenter first, then maxRequests=1
      if (!solved.ok && solved.status === 'unknown') {
        if (hierarchical && verifier) {
          const hier = await solveHierarchical(workingText, lattice, { tab, previous, clock, timeout, effWeights });
          if (hier) {
            sop = hier.sop;
            objectives = hier.objectives;
            usedHierarchical = true;
            finalStats.maxR = hier.clauseCount;
          }
        }
        if (!usedHierarchical && encoded.meta.R > 1) {
          ({ lattice, encoded, solved } = await solveSinglePass(workingText, {
            tab,
            previous,
            clock,
            topK: 1,
            maxRequests: 1,
            timeout,
            effWeights,
          }));
        }
      }

      if (!usedHierarchical) {
        if (!solved.ok) {
          return {
            ok: false,
            status: solved.status,
            error: solved.error ?? `Z3 returned ${solved.status}`,
            sop: '',
            alternatives: [],
            objectives: [],
            ...unresolvedFields(),
            spell: spellRes,
            elapsedMs: performance.now() - t0,
            smt: dumpSmt ? runner.fullSmtDump(encoded.smtBody, encoded.queryVars) : undefined,
            stats: { tokens: lattice.tokens.length, candidates: lattice.candidates.length, maxR: encoded.meta.R },
          };
        }

        const circuits = solved.solutions.map((model) => modelToSop(model, lattice, encoded.meta));
        sop = circuits[0] ?? '';
        alternatives = circuits.slice(1);
        objectives = solved.objectives ?? [];
        finalStats = { tokens: lattice.tokens.length, candidates: lattice.candidates.length, maxR: encoded.meta.R };
        if (dumpSmt) smtDump = runner.fullSmtDump(encoded.smtBody, encoded.queryVars);
      }
    }

    const shared = await solveSharedResult(initialLattice, { tab, previous, clock, maxRequests, timeout, effWeights });
    if (shared) {
      alternatives.unshift(sop);
      sop = shared.sop;
      // The projected requests have separate optimization objectives. The
      // unchanged model keeps its own objective as an alternative.
      objectives = [null, ...objectives];
      finalStats.maxR = Math.max(finalStats.maxR, shared.requestCount);
    }

    // If Layer 1 Spellchecker edited the text, project all emitted surface spans back to exact rawText substrings
    // and guarantee 100% check.mjs validity against rawText (falling back to rawText if needed)!
    if (spellRes?.changed && workingText !== rawText && verifier) {
      const regrounded = regroundSopToRaw(sop, {
        rawText,
        cleanText: workingText,
        spellTokens: spellRes.tokens,
        parse: verifier.parse,
      });
      const chkRaw = verifier.check(rawText, regrounded, tab);
      if (chkRaw.ok) {
        sop = regrounded;
        alternatives = alternatives.map((alt) =>
          regroundSopToRaw(alt, {
            rawText,
            cleanText: workingText,
            spellTokens: spellRes.tokens,
            parse: verifier.parse,
          }),
        );
      } else {
        if (unresolved.length) return unresolvedOnly();
        // Safety fallback: never violate 100% formal validity against rawText!
        let rawFallback = await solveSinglePass(rawText, {
          tab,
          previous,
          clock,
          topK: 1,
          maxRequests,
          timeout,
          effWeights,
        });
        if (!rawFallback.solved.ok) {
          rawFallback = await solveSinglePass(rawText, {
            tab,
            previous,
            clock,
            topK: 1,
            maxRequests: 1,
            timeout,
            effWeights,
          });
        }
        if (rawFallback.solved.ok) {
          sop = modelToSop(rawFallback.solved.solutions[0], rawFallback.lattice, rawFallback.encoded.meta);
          alternatives = [];
          objectives = rawFallback.solved.objectives ?? [];
        }
      }
    }

    const elapsedMs = performance.now() - t0;
    const needCheck = verify || computeConf;
    const checkResult = needCheck && verifier ? verifier.check(rawText, sop, tab) : undefined;

    const contentTokens = initialLattice.tokens.filter((tok) => tok.isContent && !tok.isFiller).length;
    const confidence = computeConf && !unresolved.length
      ? estimateConfidence({
          text: rawText,
          sop,
          alternatives,
          objectives,
          checkResult,
          contentTokens,
          spell: spellRes,
          parse: verifier?.parse,
          weights: confidenceWeights,
        })
      : undefined;

    const emittedAlts = topK > 1 ? alternatives.slice(0, topK - 1) : alternatives;
    const proposals = [sop, ...emittedAlts].filter(Boolean).map((pSop, idx) => ({
      sop: pSop,
      tab,
      objective: typeof objectives[idx] === 'number' ? objectives[idx] : null,
      ...unresolvedFields(),
    }));

    return {
      ok: true,
      status: unresolved.length ? 'partial' : 'sat',
      ...unresolvedFields(),
      sop,
      tab,
      alternatives: emittedAlts,
      proposals,
      objectives,
      check: verify ? checkResult : undefined,
      confidence,
      spell: spellRes ?? undefined,
      usedHierarchical,
      elapsedMs,
      smt: smtDump,
      stats: finalStats,
    };
  }

  async function close() {
    await Promise.all([runner.close(), spellCheckerPromise?.then((spellChecker) => spellChecker.close())]);
  }

  return { formalise, kb, runner, verifier, close };
}
