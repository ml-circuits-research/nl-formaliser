import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { regroundSopToRaw } from '../src/pipeline.mjs';
import { estimateConfidence } from '../src/confidence.mjs';

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
