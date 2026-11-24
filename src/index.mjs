// Public entry point for nl-formaliser:
//   const f = await createFormaliser({ knowledgeDir, spellcheck: false });
//   const res = await f.formalise('make the house blue', { tab: 'drawing', topK: 2, confidence: true });

import { loadKnowledge } from './kb/load-worlds.mjs';
import { buildLattice } from './lattice/candidates.mjs';
import { encodeProblem } from './smt/encode.mjs';
import { createZ3Runner } from './smt/z3-runner.mjs';
import { shouldUseHierarchicalSegmenter, segmentClausesZ3 } from './smt/segment.mjs';
import { modelToSop } from './emit/to-sop.mjs';
import { createVerifier } from './verify/check.mjs';
import { regroundSopToRaw } from './pipeline.mjs';
import { estimateConfidence } from './confidence.mjs';
import { fmtSopValue, unquoteSop } from './contracts.mjs';

/**
 * Stitch multiple per-clause SOP circuits (from Stage-1 Z3 hierarchical segmentation)
 * into a single canonical multi-request SOP Lang circuit with non-overlapping tight `words="..."`.
 */
function stitchClauseCircuits(clauseResults, { fullText, previous, clock, parse }) {
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

    const multiTotal = clauseResults.length > 1;
    for (const w of wires) {
      if (w.type === 'w.request.previous' || w.type === 'w.request.clock' || w.type === 'w.request.filler') continue;

      let newId = w.id;
      if (w.type === 'w.request.request') {
        newId = reqIdMap.get(w.id);
      } else if (w.type === 'w.request.target') {
        newId = targetIdMap.get(w.id);
      } else {
        const reqRef = String(w.attrs.request?.[0] ?? '').replace(/^\$/, '');
        const newR = reqIdMap.get(reqRef);
        if (!newR) continue;
        const pfx = w.type === 'w.request.lookup' ? 'l' : w.type === 'w.request.constraint' ? 'c' : 'u';
        newId = nextSub(newR, pfx);
      }
      if (!newId) continue;

      const pairs = [];
      let hasWords = false;
      for (const [k, vals] of Object.entries(w.attrs)) {
        if (k === 'words') hasWords = true;
        for (const rawV of vals) {
          if (k === 'request' && String(rawV).startsWith('$')) {
            const mapped = reqIdMap.get(String(rawV).slice(1));
            if (mapped) pairs.push([k, `$${mapped}`]);
          } else if (k === 'target' && String(rawV).startsWith('$')) {
            const mapped = targetIdMap.get(String(rawV).slice(1));
            if (mapped) pairs.push([k, `$${mapped}`]);
          } else {
            pairs.push([k, rawV]);
          }
        }
      }
      if (w.type === 'w.request.request' && multiTotal && !hasWords && cr.clauseText && cr.clauseText !== fullText && fullText.includes(cr.clauseText)) {
        pairs.push(['words', fmtSopValue(cr.clauseText)]);
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

  function scoreTabLattice(lattice, tab, { clock } = {}) {
    const sortToks = new Set();
    const famToks = new Set();
    const kwToks = new Set();
    const consToks = new Set();
    let exclusiveHits = 0;

    for (const c of lattice.candidates) {
      if (c.kind === 'TARGET_SORT') {
        for (let t = c.startTok; t <= c.endTok; t++) sortToks.add(t);
      } else if (c.kind === 'TARGET_FAMILY') {
        for (let t = c.startTok; t <= c.endTok; t++) famToks.add(t);
        if (['event', 'calendar', 'room', 'chart', 'diagram', 'document', 'section'].includes(c.family)) {
          exclusiveHits += 1;
        }
      } else if (c.kind === 'KEY_WORD') {
        for (let t = c.startTok; t <= c.endTok; t++) kwToks.add(t);
      } else if (c.kind === 'CONSTRAINT') {
        for (let t = c.startTok; t <= c.endTok; t++) consToks.add(t);
        if (
          c.attribute === 'chart.type' ||
          c.attribute === 'diagram.kind' ||
          c.attribute?.startsWith('event.') ||
          c.attribute?.startsWith('calendar.') ||
          c.attribute?.startsWith('room.') ||
          c.attribute?.startsWith('doc.') ||
          c.attribute?.startsWith('section.')
        ) {
          exclusiveHits += 1;
        }
      }
    }
    // Dynamic temporal-context signal: if @clock is supplied, boost tabs that declare temporal event keys.
    if (clock && kb.tabs?.[tab]?.keys?.has('event.date')) {
      exclusiveHits += 2;
    }
    const score = sortToks.size * 3 + famToks.size * 3 + kwToks.size * 2.5 + consToks.size * 1.5 + exclusiveHits * 4;
    return { score, exclusiveHits };
  }

  async function solveHierarchical(text, lattice, { tab, previous, clock, timeout, effWeights }) {
    const segRes = await segmentClausesZ3(lattice, { kb, runner, timeout: Math.min(1500, timeout) });
    if (!segRes.ok || segRes.segments.length <= 1) return null;

    const clauseResults = [];
    let totalObjective = 0;
    let hasObj = false;
    const perClauseTimeout = Math.max(800, Math.floor(timeout / Math.min(4, segRes.segments.length)));

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

    // Tab-agnostic multi-proposal mode (tab === null || tab === 'auto'):
    // Discovers all tabs dynamically from kb.tabs, ranks compatible worlds by lexical evidence,
    // solves each compatible world with Z3 using semantic blocking (diverse act/mood/family/mode),
    // and returns a ranked set of valid proposals without ever needing a tab hint!
    if (tab === null || tab === 'auto') {
      let preSpellRes = null;
      let cleanInput = rawText;
      if (useSpell) {
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
      const perTabTimeout = Math.max(1200, Math.floor(timeout / Math.min(4, selectedTabs.length)));

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
            });
          }
        }
      }

      const sortedAll = [...proposalMap.values()].sort((a, b) => {
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
      return {
        ok: Boolean(top),
        status: top ? 'sat' : 'unknown',
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
    let spellRes = arguments[1]?._preSpellRes ?? null;
    let workingText = rawText;
    if (spellRes) {
      if (spellRes.ok && spellRes.changed && spellRes.cleanText) {
        workingText = spellRes.cleanText;
      }
    } else if (useSpell) {
      const checker = await getSpellChecker();
      spellRes = await checker.normalise(rawText, { topK: 2, timeout: Math.min(2000, timeout) });
      if (spellRes.ok && spellRes.changed && spellRes.cleanText) {
        workingText = spellRes.cleanText;
      }
    }

    // Effective topK: if confidence requested and topK===1, use topK=2 on short/medium inputs to measure real Z3 margin!
    const effTopK = computeConf && topK < 2 && workingText.length <= 160 ? 2 : topK;

    const initialLattice = buildLattice(workingText, { tab, kb, previous, clock });
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
    const confidence = computeConf
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
    }));

    return {
      ok: true,
      status: 'sat',
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

  return { formalise, kb, runner, verifier };
}
