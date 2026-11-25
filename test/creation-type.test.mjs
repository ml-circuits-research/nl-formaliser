import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');
const markerSize = ['chart.markerSize', 'small', '', 'result'];

test('creation modifiers preserve the grounded catalog type', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    ['Make a new line chart with small marker size', 'chart', [
      ['chart.type', 'line', 'new line chart', 'result'], markerSize,
    ]],
    ['Make a line chart with small marker size', 'chart', [
      ['chart.type', 'line', '', 'result'], markerSize,
    ]],
    ['Make a new bar chart with small marker size', 'chart', [
      ['chart.type', 'bar', 'new bar chart', 'result'], markerSize,
    ]],
    ['Create a new scatter chart', 'chart', [['chart.type', 'scatter', 'new scatter chart', 'result']]],
    ['Make a new mind map', 'diagram', [['diagram.kind', 'mind_map', 'new mind map', 'result']]],
    ['Make a new chart', 'chart', []],
    ['Make a bar chart called "New Line Chart"', 'chart', [
      ['chart.type', 'bar', '', 'result'], ['chart.title', 'New Line Chart', '', 'result'],
    ]],
  ];
  for (const [text, family, expected] of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab: 'diagram', verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), ['make'], result.sop);
      assert.deepEqual(targets.map((wire) => ['family', 'mode', 'determiner'].map((key) => value(wire, key))),
        [[family, 'new', 'indefinite']], result.sop);
      const parts = constraints.map((wire) => {
        const attribute = value(wire, 'attribute');
        return [attribute === 'chart.label' ? 'chart.title' : attribute, ...['value', 'words', 'phase'].map((key) => value(wire, key))];
      });
      assert.deepEqual(parts, expected, result.sop);
      assert.ok(constraints.every((wire) => value(wire, 'request') === `$${requests[0].id}`), result.sop);
      assert.equal(wires.some((wire) => wire.type === 'w.request.unread'), false, result.sop);
    });
  }
});
