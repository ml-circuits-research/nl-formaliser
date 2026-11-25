import test from 'node:test';
import assert from 'node:assert/strict';
import { unquoteSop } from '../src/contracts.mjs';
import { createFormaliser } from '../src/index.mjs';

const fields = (wire, ...keys) => keys.map((key) => unquoteSop(wire.attrs[key]?.[0] ?? ''));

test('resultative changes use spatial descriptions to select the existing owner', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    { text: 'Paint the node below n4 red', relation: ['position', 'below', 'n4'], colour: 'red' },
    {
      text: 'Paint the rectangle near the triangle green', sort: 'rectangle',
      relation: ['position', 'near', 'triangle'], colour: 'green',
    },
    {
      text: 'Make the rectangle under the oval blue', sort: 'rectangle',
      relation: ['position', 'below', 'oval'], colour: 'blue',
    },
    {
      text: 'Paint the house near the cabin green', tab: 'drawing', family: 'drawn', sort: 'house',
      relation: ['relation', 'near', 'cabin'], colour: 'green',
    },
    {
      text: 'Paint the house behind the tree light blue', tab: 'drawing', family: 'drawn', sort: 'house',
      relation: ['relation', 'behind', 'tree'], colour: 'light blue',
    },
    { text: 'Paint n4 red', name: 'n4', colour: 'red' },
    { text: 'Move the node below n4', act: 'place', relation: ['position', 'below', 'n4'] },
  ];

  for (const {
    text, tab = 'diagram', family = 'node', sort = '', name = '', act = 'change', relation, colour,
  } of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, topK: 3, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => fields(wire, 'act')), [[act]], result.sop);
      assert.deepEqual(targets.map((wire) => fields(wire, 'family', 'mode', 'sort', 'name')),
        [[family, 'existing', sort, name]], result.sop);
      if (family === 'node' && !name && !sort) {
        assert.deepEqual(fields(targets[0], 'family_words'), ['node'], result.sop);
      }

      const expected = [];
      if (relation) {
        const [key, value, landmark] = relation;
        expected.push([`${family}.${key}`, value, act === 'place' ? 'result' : 'selector']);
        expected.push([`${family}.anchor`, landmark, 'selector']);
      }
      if (colour) expected.push([`${family}.colour`, colour, 'result']);
      assert.deepEqual(constraints.map((wire) => {
        assert.deepEqual(fields(wire, 'request'), [`$${requests[0].id}`], result.sop);
        const [attribute, value, phase] = fields(wire, 'attribute', 'value', 'phase');
        return [attribute.replace(/\.color$/, '.colour'), value, phase];
      }), expected, result.sop);
    });
  }
});
