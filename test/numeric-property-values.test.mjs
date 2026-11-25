import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('numeric property frames consume typed values and leave later commands available', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    ['diagram', 'Set the width on the node to 15 and undo', ['change', 'undo'], 'node', '',
      ['node.width', '15', '', '', '', 'width']],
    ['drawing', 'Set the width on the house to 25 and undo', ['change', 'undo'], 'drawn', 'house',
      ['drawn.width', '25', '', '', '', 'width']],
    ['diagram', 'Set the width on the node to fifteen pixels', ['change'], 'node', '',
      ['node.width', '15', 'fifteen pixels', '15', 'pixel', 'width']],
    ['diagram', 'Set the height on the node to twenty five', ['change'], 'node', '',
      ['node.height', '25', 'twenty five', '', '', 'height']],
    ['diagram', 'Set the width on the node to "15"', ['change'], 'node', '',
      ['node.width', '15', '', '', '', 'width']],
    ['calendar', 'Set the duration on the meeting to thirty minutes', ['change'], 'meeting', '',
      ['meeting.duration', '30', 'thirty minutes', '30', 'minute', 'duration']],
    ['diagram', 'Set the title on the chart to Build and Plan', ['change'], 'chart', '',
      ['chart.title', 'Build and Plan', '', '', '', 'title']],
  ];
  for (const [tab, text, acts, family, sort, expected] of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const target = wires.find((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), acts, result.sop);
      assert.deepEqual(['family', 'mode', 'sort'].map((key) => value(target, key)), [family, 'existing', sort], result.sop);
      assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'words', 'measure', 'unit', 'key_words']
        .map((key) => value(wire, key))), [expected], result.sop);
      assert.equal(value(constraints[0], 'phase'), 'result', result.sop);
      assert.equal(value(constraints[0], 'request'), `$${requests[0].id}`, result.sop);
    });
  }
});
