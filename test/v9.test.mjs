import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { regroundSopToRaw } from '../src/pipeline.mjs';
import { estimateConfidence } from '../src/confidence.mjs';
import { createZ3SemanticEvaluator } from '../eval/z3-equiv.mjs';

let formaliser;

test('v9: setup formaliser with dynamic SOP KB and standalone spellcheck bridge', async () => {
  formaliser = await createFormaliser({ spellcheck: true });
  assert.ok(formaliser.kb.meta.discoveredWorlds.length >= 15);
  assert.ok(formaliser.kb.meta.enShardsLoaded >= 50);
  assert.ok(formaliser.kb.meta.framesCount >= 400);
  assert.ok(formaliser.kb.meta.lexiconsCount >= 30);
  assert.ok(formaliser.kb.meta.markingsCount >= 80);
});

test('v9: Layer 1 -> Layer 2 spellcheck bridge fixes typos with 100% raw check.mjs validity', async () => {
  const cases = [
    ['drawing', 'copy the atble', 'copy', 'sort=table', 'sort_words=atble'],
    ['drawing', 'a small rtee', 'make', 'sort=tree', 'sort_words=rtee'],
    ['diagram', 'bar ch art', 'make', 'attribute=chart.type value=bar', ''],
  ];
  for (const [tab, text, expAct, expPiece1, expPiece2] of cases) {
    const res = await formaliser.formalise(text, { tab, spellcheck: true, verify: true, confidence: true });
    assert.equal(res.ok, true);
    assert.equal(res.check.ok, true, `check.mjs failed on "${text}": ${JSON.stringify(res.check.errors)}`);
    assert.equal(res.spell?.changed, true);
    assert.ok(res.sop.includes(`act=${expAct}`), `expected act=${expAct} in:\n${res.sop}`);
    assert.ok(res.sop.includes(expPiece1), `expected ${expPiece1} in:\n${res.sop}`);
    if (expPiece2) assert.ok(res.sop.includes(expPiece2), `expected ${expPiece2} in:\n${res.sop}`);
    if (res.check.warnings.length === 0) {
      assert.ok(res.confidence.score >= 0.24, `expected reasonable calibrated confidence on "${text}", got ${res.confidence.score}`);
      assert.ok(['high', 'medium'].includes(res.confidence.band), res.confidence.summary);
    }
  }
});

test('v9: Stage-1 Hierarchical Z3 segments 6-object zoo scene cleanly without cutting "next to"', async () => {
  const zoo =
    'set up the zoo scene: four medium grey cages in a row along the path, ' +
    'four small green parrots on top of the cage, ' +
    'a medium keeper facing left with a proud face on the left, ' +
    'a medium brown bench next to the gate, ' +
    'a small brown sign on the right, ' +
    'and a small blue bucket next to the keeper';

  const res = await formaliser.formalise(zoo, { tab: 'drawing', spellcheck: false, verify: true, confidence: true });
  assert.equal(res.ok, true);
  assert.equal(res.usedHierarchical, true);
  assert.equal(res.check.ok, true, `check.mjs failed: ${JSON.stringify(res.check.errors)}`);
  const reqCount = res.sop.split('\n').filter((l) => l.includes('w.request.request')).length;
  assert.equal(reqCount, 6, `Expected 6 requests for 6 zoo items, got ${reqCount}:\n${res.sop}`);
  assert.ok(!res.sop.includes('words="to the gate'), 'Must not split inside "next to"');
  assert.ok(res.elapsedMs < 2500, `Expected fast hierarchical solve (<2.5s), got ${res.elapsedMs.toFixed(0)}ms`);
});

test('v9: diagram-frames single-letter names ("connect A to C") emit link.from=A link.to=C', async () => {
  const res = await formaliser.formalise('connect A to C', { tab: 'diagram', spellcheck: false, verify: true, confidence: true });
  assert.equal(res.ok, true);
  assert.equal(res.check.ok, true, JSON.stringify(res.check.errors));
  assert.ok(res.sop.includes('act=connect'));
  assert.ok(res.sop.includes('family=link'));
  assert.ok(res.sop.includes('attribute=link.from value=A'));
  assert.ok(res.sop.includes('attribute=link.to value=C'));
});

test('v9: Honest symbolic confidence separates clean clear parses (HIGH) from unreadable gibberish (ABSTAIN)', async () => {
  const clean = await formaliser.formalise('make the house blue', { tab: 'drawing', spellcheck: false, verify: true, confidence: true });
  assert.equal(clean.ok, true);
  assert.equal(clean.check.ok, true);
  assert.equal(typeof clean.objectives[0], 'number');
  assert.equal(clean.confidence.ambiguous, false, `color vs colour alias must not be flagged ambiguous: ${clean.confidence.summary}`);
  assert.equal(clean.confidence.band, 'high', clean.confidence.summary);
  assert.ok(clean.confidence.score >= 0.38, `expected calibrated score >= 0.38, got ${clean.confidence.score}`);

  const junk = await formaliser.formalise('foobar blargle something', { tab: 'drawing', spellcheck: false, verify: true, confidence: true });
  assert.equal(junk.ok, true);
  assert.equal(junk.check.ok, true);
  assert.equal(junk.confidence.band, 'abstain', junk.confidence.summary);
  assert.ok(junk.confidence.score < 0.15);
  assert.ok(clean.confidence.score - junk.confidence.score >= 0.25);
  assert.ok(junk.confidence.signals.unreadCount >= 2);
});

test('v9: regroundSopToRaw helper preserves exact raw substrings', () => {
  const raw = 'copy the atble';
  const clean = 'copy the table';
  const sop = '@r1 w.request.request act=copy mood=do predicate=copy\n@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite fill=description sort=table';
  const out = regroundSopToRaw(sop, {
    rawText: raw,
    cleanText: clean,
    spellTokens: [
      { text: 'copy', rawText: 'copy', rawStart: 0, rawEnd: 4, op: 'keep' },
      { text: 'the', rawText: 'the', rawStart: 5, rawEnd: 8, op: 'keep' },
      { text: 'table', rawText: 'atble', rawStart: 9, rawEnd: 14, op: 'edit' },
    ],
    parse: formaliser.verifier.parse,
  });
  assert.ok(out.includes('sort=table sort_words=atble'));
  const chk = formaliser.verifier.check(raw, out, 'drawing');
  assert.equal(chk.ok, true, JSON.stringify(chk.errors));
});

test('v9: estimateConfidence returns score=0 and abstain when checkResult is invalid', () => {
  const c = estimateConfidence({
    text: 'make the house blue',
    sop: '@r1 w.request.request act=bogus',
    checkResult: { ok: false, errors: [{ why: 'bad act' }], warnings: [] },
  });
  assert.equal(c.score, 0);
  assert.equal(c.band, 'abstain');
});

test('v9: tab-agnostic multi-proposal mode (tab=null) emits valid diverse readings across compatible worlds', async () => {
  const res1 = await formaliser.formalise('Please, put Review on the Work 6 calendar on 2026-12-14 at 14:00 UTC for 30 minutes', {
    tab: null,
    maxProposals: 6,
    perTabTopK: 2,
    spellcheck: false,
  });
  assert.equal(res1.ok, true);
  assert.ok(res1.proposals.length >= 2);
  const calProps = res1.proposals.filter((p) => p.tab === 'calendar');
  assert.ok(calProps.length >= 1, `Expected calendar proposal in tab-agnostic mode, got tabs: ${res1.proposals.map((p) => p.tab).join(',')}`);
  assert.ok(calProps.some((p) => p.sop.includes('act=make') || p.sop.includes('act=place')));

  const res2 = await formaliser.formalise('make it red', {
    tab: null,
    maxProposals: 6,
    perTabTopK: 1,
    spellcheck: false,
  });
  assert.equal(res2.ok, true);
  const tabs2 = new Set(res2.proposals.map((p) => p.tab));
  assert.ok(tabs2.size >= 2, `Expected multiple compatible worlds for ambiguous "make it red", got ${[...tabs2].join(',')}`);
});

test('v9.5: dynamic SOP alternations, k.actions.similar, k.objects.stand_in, and Z3 Semantic Evaluator (z3-equiv.mjs)', async () => {
  // 1. Verify newly loaded dynamic SOP modalities
  assert.ok(formaliser.kb.grammar.alternations.length >= 350, `Expected >=350 alternations, got ${formaliser.kb.grammar.alternations.length}`);
  assert.ok(formaliser.kb.grammar.questionAlternations.size >= 30);
  assert.ok(formaliser.kb.grammar.benefactiveVerbs.has('draw'));
  assert.ok(formaliser.kb.domain.standIns.get('dinghy') === 'boat');
  assert.ok(formaliser.kb.domain.fills.get('filled in') === 'solid');

  // Indirect question alternation from alternations.sop ("tell me where the house is")
  const iq = await formaliser.formalise('tell me where the house is', { tab: 'drawing', spellcheck: false, verify: true });
  assert.equal(iq.ok, true);
  assert.equal(iq.check.ok, true);
  assert.ok(iq.sop.includes('act=ask') && iq.sop.includes('question=where'), iq.sop);

  // Stand-in drawable noun ("add a dinghy")
  const st = await formaliser.formalise('add a dinghy', { tab: 'drawing', spellcheck: false, verify: true });
  assert.equal(st.ok, true);
  assert.equal(st.check.ok, true);
  assert.ok(st.sop.includes('sort=dinghy'), st.sop);

  // 2. Verify Z3 Semantic Evaluator (L4 on unit/stand-in/refinement equivalence; strict L1a/L1c/L1d on real errors!)
  const z3Eval = await createZ3SemanticEvaluator({ kb: formaliser.kb, verifier: formaliser.verifier });

  // Unit + span-head + act equivalence: 1 hour === 60 minutes, "Work 2 calendar" === "Work 2" -> L4!
  const textCal = 'Please put Review on the Work 2 calendar on 2026-12-02 at 10:00 UTC for 1 hour';
  const goldCal = `@f1 w.request.filler text=Please\n@r1 w.request.request act=make mood=do words="put Review on the Work 2 calendar on 2026-12-02 at 10:00 UTC for 1 hour" predicate=put\n@r1.t w.request.target request=$r1 family=meeting mode=new determiner=indefinite name=Review\n@r1.c1 w.request.constraint request=$r1 on=attribute attribute=meeting.calendar value="Work 2" key_word=calendar\n@r1.c2 w.request.constraint request=$r1 on=attribute attribute=meeting.day value="2026-12-02"\n@r1.c3 w.request.constraint request=$r1 on=attribute attribute=meeting.time value="10:00"\n@r1.c4 w.request.constraint request=$r1 on=attribute attribute=meeting.timezone value=UTC\n@r1.c5 w.request.constraint request=$r1 on=attribute attribute=meeting.length value="60" measure=60 unit=minute measure_words="1 hour"`;
  const realCal = await formaliser.formalise(textCal, { tab: 'calendar', spellcheck: false });
  const rUnit = await z3Eval.evaluatePairZ3({ text: textCal, tab: 'calendar', goldSop: goldCal, predSop: realCal.sop });
  assert.equal(rUnit.legendGrade, 'L4', `Expected L4 for real formaliser output on 1-hour meeting, got ${rUnit.legendGrade}`);

  // Opposing act (remove vs make) MUST remain strict L1a!
  const rBadAct = await z3Eval.evaluatePairZ3({
    text: 'delete the circle',
    tab: 'drawing',
    goldSop: `@r1 w.request.request act=remove mood=do predicate=delete\n@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite fill=description sort=circle`,
    predSop: `@r1 w.request.request act=make mood=do predicate=delete\n@r1.t w.request.target request=$r1 family=drawn mode=new determiner=indefinite sort=circle`,
  });
  assert.equal(rBadAct.legendGrade, 'L1a', 'Opposing act (delete -> make) must be graded L1a per LEGEND.md');

  // Wrong colour value (red vs blue) MUST remain strict L1c!
  const rBadVal = await z3Eval.evaluatePairZ3({
    text: 'make the circle blue',
    tab: 'drawing',
    goldSop: `@r1 w.request.request act=change mood=do predicate=make\n@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite fill=description sort=circle\n@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue`,
    predSop: `@r1 w.request.request act=change mood=do predicate=make\n@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite fill=description sort=circle\n@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=red`,
  });
  assert.ok(['L0', 'L1c'].includes(rBadVal.legendGrade), `Wrong value must never get L4, got ${rBadVal.legendGrade}`);
});
