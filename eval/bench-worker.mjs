// Parallel benchmark worker thread for eval/benchmark.mjs.
// Each worker hosts its own KB, verifier, and persistent Z3 WASM instance.

import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

import { unquoteSop } from '../src/contracts.mjs';
import { createVerifier } from '../src/verify/check.mjs';
import { createFormaliser } from '../src/index.mjs';
import { compareCircuits, compareProposals } from './compare.mjs';
import { createZ3SemanticEvaluator } from './z3-equiv.mjs';

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
    // Unparseable goldSop will be recorded by compareCircuits.
  }
  return { previous, clock };
}

const {
  knowledgeDir,
  source,
  spellcheck = false,
  confidence = false,
  tabAgnostic = false,
  z3Eval = false,
  maxProposals = 6,
  perTabTopK = 2,
} = workerData;

const [verifier, formaliser] = await Promise.all([
  createVerifier({ knowledgeDir }),
  createFormaliser({ knowledgeDir, spellcheck, includeLegacy: source !== 'webmeet' }),
]);

const z3Evaluator = z3Eval
  ? await createZ3SemanticEvaluator({ kb: formaliser.kb, verifier })
  : null;

function buildKnownVocab(kb) {
  const vocab = new Set();
  for (const w of kb?.grammar?.grammarWords ?? []) vocab.add(w);
  for (const w of kb?.grammar?.fillerWords ?? []) vocab.add(w);
  for (const w of kb?.verbs?.keys() ?? []) if (!w.includes(' ')) vocab.add(w);
  for (const tabObj of Object.values(kb?.tabs ?? {})) {
    for (const w of tabObj.keyWordIndex?.keys() ?? []) if (!w.includes(' ')) vocab.add(w);
    for (const w of tabObj.closedValueIndex?.keys() ?? []) if (!w.includes(' ')) vocab.add(w);
    for (const w of tabObj.familyWords?.keys() ?? []) if (!w.includes(' ')) vocab.add(w);
  }
  for (const map of [kb?.domain?.colours, kb?.domain?.shapes, kb?.domain?.objects, kb?.domain?.bodyParts, kb?.domain?.wearables, kb?.domain?.feelings, kb?.domain?.scenes, kb?.domain?.layouts, kb?.domain?.styles, kb?.domain?.diagrams, kb?.domain?.charts, kb?.domain?.genres, kb?.domain?.units]) {
    for (const w of map?.keys?.() ?? []) if (!w.includes(' ')) vocab.add(w);
  }
  return vocab;
}

const knownVocab = buildKnownVocab(formaliser.kb);

parentPort.postMessage({ type: 'ready' });

parentPort.on('message', async (msg) => {
  if (msg.type === 'stop') {
    process.exit(0);
  }
  if (msg.type !== 'job') return;

  const { idx, row } = msg;
  try {
    if (source === 'keys') {
      const t0 = performance.now();
      const res = await formaliser.formalise(row.text, { tab: row.tab });
      const ms = performance.now() - t0;
      const predSop = typeof res === 'string' ? res : (res?.sop ?? res?.circuit ?? '');
      const predCheck = verifier.check(row.text, predSop, row.tab);
      const wires = predCheck.wires ?? [];
      const keyHit = wires.some(
        (w) =>
          (w.type === 'w.request.constraint' && unquoteSop(w.attrs.attribute?.[0]) === row.expectedKey) ||
          (w.type === 'w.request.request' && unquoteSop(w.attrs.asked?.[0]) === row.expectedKey),
      );
      parentPort.postMessage({
        type: 'result',
        idx,
        predSop,
        ok: predCheck.ok,
        keyHit,
        ms,
      });
      return;
    }

    const t0 = performance.now();
    const res = source === 'webmeet'
      ? await formaliser.formaliseCurrentText(row.text, { topK: maxProposals, spellcheck, confidence })
      : await formaliser.formalise(row.text, {
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
    const conf = res?.confidence
      ? {
          score: res.confidence.score,
          band: res.confidence.band,
          ambiguous: res.confidence.ambiguous,
          signals: res.confidence.signals,
        }
      : null;
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
            knownVocab,
          })
        : compareCircuits({
            text: row.text,
            ...(source !== 'webmeet' && { tab: row.tab }),
            goldSop: row.goldSop,
            predSop,
            verifier,
            knownVocab,
          });

    // Strip heavy parse trees before IPC.
    const slimCmp = {
      verdict: cmp.verdict,
      fairCategory: cmp.fairCategory,
      attribution: cmp.attribution,
      legendGrade: cmp.legendGrade,
      mechanicalLegendGrade: cmp.mechanicalLegendGrade ?? cmp.legendGrade,
      equivRedundantId: cmp.equivRedundantId,
      inputHasTypo: cmp.inputHasTypo,
      goldAnnotationFlawed: cmp.goldAnnotationFlawed,
      goldIssueReasons: cmp.goldIssueReasons,
      bestReferenceColumn: cmp.bestReferenceColumn,
      referenceIssues: cmp.referenceIssues,
      predErrorReasons: cmp.predErrorReasons,
      predValid: cmp.predValid,
      goldValid: cmp.goldValid,
      predZeroWarn: cmp.predZeroWarn,
      goldZeroWarn: cmp.goldZeroWarn,
      reqCountExact: cmp.reqCountExact,
      actExact: cmp.actExact,
      actModeExact: cmp.actModeExact,
      moodExact: cmp.moodExact,
      questionExact: cmp.questionExact,
      targetFamilyExact: cmp.targetFamilyExact,
      targetModeExact: cmp.targetModeExact,
      targetSortOrNameMatch: cmp.targetSortOrNameMatch,
      lookupMatch: cmp.lookupMatch,
      constraintStrictF1: cmp.constraintStrictF1,
      constraintAliasF1: cmp.constraintAliasF1,
      semanticExact: cmp.semanticExact,
      proposalCount: cmp.proposalCount ?? 1,
      bestProposalIdx: cmp.bestProposalIdx ?? 0,
      ...(source !== 'webmeet' && { tabHit: cmp.tabHit ?? true }),
    };

    const bestPredSop =
      (row.goldReferences || tabAgnostic || proposals.length > 1) && typeof cmp.bestProposalIdx === 'number' && proposals[cmp.bestProposalIdx]?.sop
        ? proposals[cmp.bestProposalIdx].sop
        : predSop;

    parentPort.postMessage({
      type: 'result',
      idx,
      predSop: bestPredSop,
      cmp: slimCmp,
      conf,
      spellChanged,
      ms,
    });
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      idx,
      message: err?.message ?? String(err),
    });
  }
});
