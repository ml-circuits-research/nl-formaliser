import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('coordinated frame matches keep property edits with their own targets', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    ['diagram', ', then ', [
      ['Set the width on the node to 15', 'node', '', [['node.width', '15', 'result']]],
      ['set the height on the chart to 20', 'chart', '', [['chart.height', '20', 'result']]],
    ]],
    ['diagram', ' and ', [
      ['Set the width on the node under the oval to 15', 'node', '', [
        ['node.position', 'below', 'selector'], ['node.anchor', 'oval', 'selector'], ['node.width', '15', 'result'],
      ]],
      ['set the height on the node near the triangle to 20', 'node', '', [
        ['node.position', 'near', 'selector'], ['node.anchor', 'triangle', 'selector'], ['node.height', '20', 'result'],
      ]],
    ]],
    ['drawing', ' and ', [
      ['Set the colour on the house behind the tree to blue', 'drawn', 'house', [
        ['drawn.relation', 'behind', 'selector'], ['drawn.anchor', 'tree', 'selector'], ['drawn.colour', 'blue', 'result'],
      ]],
      ['set the colour on the dog near the cabin to red', 'drawn', 'dog', [
        ['drawn.relation', 'near', 'selector'], ['drawn.anchor', 'cabin', 'selector'], ['drawn.colour', 'red', 'result'],
      ]],
    ]],
  ];
  for (const [tab, joiner, expected] of cases) {
    const text = expected.map(([words]) => words).join(joiner);
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.equal(requests.length, expected.length, result.sop);
      assert.equal(targets.length, expected.length, result.sop);
      assert.equal(constraints.length, expected.reduce((n, record) => n + record[3].length, 0), result.sop);
      for (const [i, [words, family, sort, effects]] of expected.entries()) {
        const request = requests[i];
        assert.deepEqual(['act', 'words'].map((key) => value(request, key)), ['change', words], result.sop);
        const owned = (wire) => value(wire, 'request') === `$${request.id}`;
        const target = targets.find(owned);
        assert.deepEqual(['family', 'mode', 'sort'].map((key) => value(target, key)), [family, 'existing', sort], result.sop);
        assert.deepEqual(constraints.filter(owned).map((wire) => ['attribute', 'value', 'phase'].map((key) => value(wire, key))),
          effects, result.sop);
      }
    });
  }

  for (const [text, act, attribute, values] of [
    ['Set the title on the chart to Build and Plan', 'change', 'chart.title', ['Build and Plan']],
    ['Group A and B', 'group', 'node.ids', ['A', 'B']],
  ]) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab: 'diagram', verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), [act], result.sop);
      assert.deepEqual(constraints.map((wire) => [value(wire, 'attribute'), wire.attrs.value.map(unquoteSop)]),
        [[attribute, values]], result.sop);
    });
  }
});
