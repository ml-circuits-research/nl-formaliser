import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('compound property keywords bind the written value and preserve explicit owners', async (t) => {
  const formaliser = await createFormaliser();
  const tab = 'diagram';
  for (const spelling of ['colour', 'color']) {
    await t.test(`text ${spelling} retains the target from the previous turn`, async () => {
      const keyWords = `text ${spelling}`;
      const result = await formaliser.formalise(`set its ${keyWords} to blue`, {
        tab, previous: 'select Start', verify: true,
      });
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const target = wires.find((wire) => wire.type === 'w.request.target');
      const lookup = wires.find((wire) => wire.type === 'w.request.lookup');
      assert.deepEqual(['family', 'mode', 'fill', 'name'].map((key) => value(target, key)), ['node', 'existing', 'context', '']);
      assert.deepEqual(['target', 'from'].map((key) => value(lookup, key)), [`$${target.id}`, 'previous']);
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'phase', 'key_words'].map((key) => value(wire, key))),
        [['node.textColour', 'blue', 'result', keyWords]], result.sop);
    });
  }

  await t.test('marker size edits an existing chart while a separate colour edit keeps its node', async () => {
    const result = await formaliser.formalise('Set the node colour to blue, then make the marker size small', { tab, verify: true });
    assert.equal(result.check.ok, true, result.sop);
    const wires = formaliser.verifier.parse(result.sop);
    const requests = wires.filter((wire) => wire.type === 'w.request.request');
    const targets = wires.filter((wire) => wire.type === 'w.request.target');
    assert.deepEqual(requests.map((wire) => value(wire, 'act')), ['change', 'change']);
    const [node, chart] = requests.map((wire) => `$${wire.id}`);
    assert.deepEqual(targets.map((wire) => ['request', 'family', 'mode', 'name'].map((key) => value(wire, key))),
      [[node, 'node', 'existing', ''], [chart, 'chart', 'existing', '']], result.sop);
    const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
    assert.deepEqual(constraints.map((wire) => ['request', 'attribute', 'value', 'phase', 'key_words'].map((key) => value(wire, key))),
      [[node, 'node.colour', 'blue', 'result', 'colour'], [chart, 'chart.markerSize', 'small', 'result', 'marker size']], result.sop);
  });

  await t.test('the shorter reading stays available for ambiguous line width', async () => {
    const result = await formaliser.formalise('set the line width to 4', { tab, topK: 3, verify: true });
    assert.equal(result.check.ok, true, result.sop);
    assert.match(result.sop, /attribute=chart\.lineWidth value="4".*key_words="line width"/);
    assert.ok(result.alternatives.some((sop) => sop.includes('attribute=node.width')), result.alternatives.join('\n'));
  });

  await t.test('a quoted chart name stays owner evidence', async () => {
    const result = await formaliser.formalise('set the title on the chart "Marker Size" to Sales', { tab, verify: true });
    assert.equal(result.check.ok, true, result.sop);
    const wires = formaliser.verifier.parse(result.sop);
    const target = wires.find((wire) => wire.type === 'w.request.target');
    assert.deepEqual(['family', 'mode', 'name'].map((key) => value(target, key)), ['chart', 'existing', 'Marker Size']);
    const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
    assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'key_words'].map((key) => value(wire, key))),
      [['chart.title', 'Sales', 'title']], result.sop);
  });

  await t.test('an indefinite new chart keeps its compound property as a creation result', async () => {
    const result = await formaliser.formalise('Make a line chart with large marker size', { tab, verify: true });
    assert.equal(result.check.ok, true, result.sop);
    const wires = formaliser.verifier.parse(result.sop);
    const request = wires.find((wire) => wire.type === 'w.request.request');
    const target = wires.find((wire) => wire.type === 'w.request.target');
    assert.equal(value(request, 'act'), 'make');
    assert.deepEqual(['family', 'mode', 'determiner'].map((key) => value(target, key)), ['chart', 'new', 'indefinite']);
    const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
    assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'phase', 'words', 'key_words'].map((key) => value(wire, key))),
      [['chart.type', 'line', 'result', '', ''], ['chart.markerSize', 'big', 'result', 'large', 'marker size']], result.sop);
  });
});
