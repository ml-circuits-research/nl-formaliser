import test from 'node:test';
import assert from 'node:assert/strict';
import { unquoteSop } from '../src/contracts.mjs';
import { createFormaliser } from '../src/index.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('relative values retain their complete source on an explicit time property', async (t) => {
  const formaliser = await createFormaliser();
  for (const [text, scopes] of [
    ['Change the time to after sunset', ['time to after sunset']],
    ['Set the time before dawn', ['time before dawn']],
    ['Set the time to just after sunset', ['time to just after sunset']],
    ['Set the time to three minutes after sunset', ['time to three minutes after sunset']],
    ['Set the time to before the next sunrise', ['time to before the next sunrise']],
    ['Set the time after sunset and set the time before noon', ['time after sunset', 'time before noon']],
    ['Change the time to later than noon, then paint n4 blue', ['time to later than noon']],
  ]) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab: 'drawing', verify: true, topK: 2 });
      assert.equal(output.ok, true, output.error);
      for (const { sop } of output.proposals) {
        assert.equal(formaliser.verifier.check(text, sop, 'drawing').ok, true, sop);
        const wires = formaliser.verifier.parse(sop);
        const unread = wires.filter((w) => w.type === 'w.request.unread');
        assert.deepEqual(unread.map((w) => [value(w, 'text'), value(w, 'note')]), scopes.map((s) => [s, 'pp.time']), sop);
        for (const evidence of unread) {
          const owner = value(evidence, 'request');
          assert.ok(wires.some((w) => w.type === 'w.request.target' && value(w, 'request') === owner &&
            value(w, 'family') === 'page' && value(w, 'mode') === 'existing'), sop);
          assert.ok(!wires.some((w) => w.type === 'w.request.constraint' && value(w, 'request') === owner), sop);
        }
      }
      if (text.endsWith('paint n4 blue')) {
        const wires = formaliser.verifier.parse(output.sop);
        assert.ok(wires.some((w) => w.type === 'w.request.target' && value(w, 'name') === 'n4'), output.sop);
        assert.ok(wires.some((w) => w.type === 'w.request.constraint' && value(w, 'value') === 'blue'), output.sop);
      }
    });
  }
});

test('an exact scene time and grounded spatial or schedule landmarks retain their representations', async (t) => {
  const formaliser = await createFormaliser();
  for (const [tab, text, key, operand, operator] of [
    ['drawing', 'Set the time to at sunset', 'page.time', 'sunset', 'eq'],
    ['drawing', 'Set the time to nightfall', 'page.time', 'dusk', 'eq'],
    ['diagram', 'Move the node below n4', 'node.position', 'below', 'relation'],
    ['calendar', 'Move the meeting before Lunch', 'meeting.relation', 'before', 'relation'],
    ['document', 'Move the summary before the conclusion', 'section.order', 'before', 'relation'],
  ]) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(output.check?.ok, true, output.sop || output.error);
      const wires = formaliser.verifier.parse(output.sop);
      assert.ok(wires.some((w) => w.type === 'w.request.constraint' && value(w, 'attribute') === key &&
        value(w, 'value') === operand && value(w, 'operator') === operator), output.sop);
      assert.ok(!wires.some((w) => w.type === 'w.request.unread' && value(w, 'note') === 'pp.time'), output.sop);
    });
  }
});

test('typed temporal landmarks support tab-agnostic readings without external context', async () => {
  const formaliser = await createFormaliser();
  for (const [text, tab, evidence] of [
    ['Change the time to after sunset', 'drawing', 'time to after sunset'],
    ['Set the time to after 2pm', 'calendar', 'time to after 2pm'],
  ]) {
    const output = await formaliser.formalise(text, { tab: null });
    assert.equal(output.tab, tab, output.sop);
    const wires = formaliser.verifier.parse(output.sop);
    assert.ok(wires.some((w) => w.type === 'w.request.unread' && value(w, 'text') === evidence), output.sop);
    assert.ok(!wires.some((w) => w.type === 'w.request.constraint'), output.sop);
    assert.ok(output.proposals.some((proposal) => proposal.tab !== tab));
  }
  const capped = await formaliser.formalise('Set the time after sunset and set the time before noon',
    { tab: 'drawing', maxRequests: 1, topK: 2 });
  assert.equal(capped.status, 'unsat', capped.sop || capped.error);
  assert.equal(capped.sop, '');
});

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
