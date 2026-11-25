import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('anchored placement prefers the declared position while abstract relations still bind', async (t) => {
  const formaliser = await createFormaliser();
  const options = { tab: 'diagram', verify: true };
  const cases = [
    ['put in a diamond named Grind next to Sift', 'make', 'diamond', [
      ['node.label', 'Grind', 'result', '', 'named'],
      ['node.position', 'next_to', 'result', 'next to', ''],
      ['node.anchor', 'Sift', 'selector', '', ''],
    ]],
    ['move the current one so it is below n4', 'place', '', [
      ['node.position', 'below', 'result', '', ''],
      ['node.anchor', 'n4', 'selector', '', ''],
    ]],
    ['set the relation on the node to cause', 'change', '', [
      ['node.relation', 'cause', 'result', '', 'relation'],
    ]],
  ];
  for (const [text, act, sort, expected] of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, options);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), [act]);
      assert.deepEqual(targets.map((wire) => ['family', 'sort'].map((key) => value(wire, key))), [['node', sort]], result.sop);
      assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'phase', 'words', 'key_words']
        .map((key) => value(wire, key))), expected, result.sop);
      assert.ok(constraints.every((wire) => value(wire, 'request') === `$${requests[0].id}`), result.sop);
    });
  }
});
