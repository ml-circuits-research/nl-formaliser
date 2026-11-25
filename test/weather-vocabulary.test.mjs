import test from 'node:test';
import assert from 'node:assert/strict';
import { unquoteSop } from '../src/contracts.mjs';
import { createFormaliser } from '../src/index.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('closed weather values use vocabulary owned by the canonical slot', async (t) => {
  const formaliser = await createFormaliser();
  const index = formaliser.kb.tabs.drawing.closedValueIndex;
  const weather = (word) => (index.get(word) ?? []).filter((entry) => entry.attr === 'page.weather')
    .map((entry) => entry.value);
  for (const [word, expected] of [
    ['misty', 'mist'], ['foggy', 'fog'], ['hazy', 'haze'], ['overcast', 'overcast'],
    ['breezy', 'breeze'], ['windy', 'wind'], ['frosty', 'frost'], ['icy', 'ice'], ['rainy', 'rain'],
  ]) {
    await t.test(word, async () => {
      assert.deepEqual(weather(word), [expected]);
      const result = await formaliser.formalise(`Set the weather to ${word}`, { tab: 'drawing', verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const request = wires.find((wire) => wire.type === 'w.request.request');
      const target = wires.find((wire) => wire.type === 'w.request.target');
      assert.equal(value(request, 'act'), 'change', result.sop);
      assert.deepEqual(['family', 'mode'].map((key) => value(target, key)), ['page', 'existing'], result.sop);
      const effects = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(effects.map((wire) => ['attribute', 'value', 'phase', 'request'].map((key) => value(wire, key))),
        [['page.weather', expected, 'result', `$${request.id}`]], result.sop);
    });
  }
  assert.deepEqual(weather('bright sunny afternoon'), []);
  assert.deepEqual(weather('rainy day'), []);
  const scene = await formaliser.formalise('Make a rainy day scene', { tab: 'drawing', verify: true });
  assert.equal(scene.check.ok, true, scene.sop);
  const effects = formaliser.verifier.parse(scene.sop).filter((wire) => wire.type === 'w.request.constraint');
  assert.deepEqual(effects.map((wire) => [value(wire, 'attribute'), value(wire, 'value')]),
    [['page.scene', 'rainy day']], scene.sop);

  await t.test('nightfall keeps the time and weather as separate page settings', async () => {
    const result = await formaliser.formalise('change the weather to a rainy nightfall', { tab: 'drawing', verify: true });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.check.ok, true, result.sop);
    const wires = formaliser.verifier.parse(result.sop);
    const requests = wires.filter((wire) => wire.type === 'w.request.request');
    const targets = wires.filter((wire) => wire.type === 'w.request.target');
    const owner = `$${requests[0].id}`;
    assert.deepEqual(requests.map((wire) => value(wire, 'act')), ['change'], result.sop);
    assert.deepEqual(targets.map((wire) => ['family', 'mode', 'request'].map((key) => value(wire, key))),
      [['page', 'existing', owner]], result.sop);
    const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
    assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'phase', 'request'].map((key) => value(wire, key))),
      [['page.weather', 'rain', 'result', owner], ['page.time', 'dusk', 'result', owner]], result.sop);
    assert.equal(value(constraints[1], 'words'), 'nightfall', result.sop);
  });
});
