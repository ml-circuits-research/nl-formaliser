import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';

const formaliser = await createFormaliser({ withVerifier: true, timeoutMs: 5000 });

const SMOKE_CASES = [
  // Drawing
  { tab: 'drawing', text: 'add a boy', expectAct: 'make', expectFamily: 'drawn' },
  { tab: 'drawing', text: 'make the house blue', expectAct: 'change', expectFamily: 'drawn' },
  { tab: 'drawing', text: 'please switch to the robot preset', expectAct: 'change', expectLookup: true },
  { tab: 'drawing', text: 'move the house to 260,180, then make the house blue', expectReqs: 2 },
  { tab: 'drawing', text: 'Make the house a lot bigger.', expectAct: 'change', expectFamily: 'drawn' },
  { tab: 'drawing', text: 'please shift the nose up', expectAct: 'place', expectFamily: 'part' },
  { tab: 'drawing', text: 'Add a giant wasp.', expectAct: 'make', expectFamily: 'drawn' },
  { tab: 'drawing', text: 'place Sri above the starbucks block', expectAct: 'place', expectFamily: 'drawn' },
  // Diagram
  { tab: 'diagram', text: 'make a bar chart of the stadiums by country', expectAct: 'make', expectFamily: 'chart' },
  { tab: 'diagram', text: 'please add a rectangle labelled Review', expectAct: 'make', expectFamily: 'node' },
  { tab: 'diagram', text: 'delete all circles', expectAct: 'remove', expectFamily: 'node' },
  { tab: 'diagram', text: 'bar graph, orange horizontal .6; name Power; x on top; invert y', expectAct: 'make', expectFamily: 'chart' },
  // Document
  { tab: 'document', text: 'please make a new blank document called Report', expectAct: 'make' },
  { tab: 'document', text: 'set chapter right', expectAct: 'change' },
  // Calendar
  { tab: 'calendar', text: 'please select the Review event', expectAct: 'pick', expectFamily: 'meeting' },
  { tab: 'calendar', text: 'get rid of the Review meeting', expectAct: 'remove', expectFamily: 'meeting' },
];

for (const tc of SMOKE_CASES) {
  test(`[${tc.tab}] "${tc.text}" produces schema-valid w.request SOP Lang`, async () => {
    const res = await formaliser.formalise(tc.text, { tab: tc.tab, verify: true });
    assert.equal(res.ok, true, `Z3 failed: ${res.error}`);
    assert.ok(res.sop.length > 0, 'empty SOP output');
    assert.equal(
      res.check.ok,
      true,
      `Verifier errors for "${tc.text}":\n${res.sop}\nERRORS: ${JSON.stringify(res.check.errors, null, 2)}`
    );
    const reqs = res.check.wires.filter((w) => w.type === 'w.request.request');
    const targets = res.check.wires.filter((w) => w.type === 'w.request.target');
    if (tc.expectReqs !== undefined) assert.equal(reqs.length, tc.expectReqs, `Expected ${tc.expectReqs} requests:\n${res.sop}`);
    if (tc.expectAct) assert.equal(reqs[0].attrs.act?.[0], tc.expectAct, `Wrong act:\n${res.sop}`);
    if (tc.expectFamily) assert.equal(targets[0].attrs.family?.[0], tc.expectFamily, `Wrong family:\n${res.sop}`);
    if (tc.expectLookup) {
      assert.ok(res.check.wires.some((w) => w.type === 'w.request.lookup'), `Expected lookup:\n${res.sop}`);
    }
  });
}
