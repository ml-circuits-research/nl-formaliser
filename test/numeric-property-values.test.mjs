import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('context properties preserve typed values and unsupported measured operands', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    { tab: 'diagram', text: 'Make the width medium', unread: 'width medium', families: ['node', 'chart', 'link'] },
    { tab: 'drawing', text: 'Make the width medium', unread: 'width medium', families: ['drawn', 'part'] },
    { tab: 'diagram', text: 'Set the width to whatever fits and undo', unread: 'width to whatever fits', undo: true },
    { tab: 'diagram', text: 'Make the height whatever fits then undo', unread: 'height whatever fits', undo: true },
    { tab: 'diagram', text: 'Make the grid width medium', attribute: 'chart.gridWidth', operand: 'medium', key: 'grid width' },
    { tab: 'diagram', text: 'Make the colour bar length medium', attribute: 'chart.colourBarLength', operand: 'medium', key: 'colour bar length' },
    { tab: 'diagram', text: 'Set the width to sixteen pixels and undo', attribute: 'node.width', operand: '16', key: 'width', measure: 'sixteen pixels', undo: true },
    { tab: 'diagram', text: 'Set the width to "15"', attribute: 'node.width', operand: '15', key: 'width' },
  ];
  for (const { tab, text, unread, undo, families, attribute, operand, key, measure } of cases) {
    await t.test(`${tab}: ${text}`, async () => {
      const output = await formaliser.formalise(text, { tab, topK: 2, verify: true });
      assert.equal(output.check?.ok, true, output.sop || output.error);
      const wires = formaliser.verifier.parse(output.sop);
      const requests = wires.filter((w) => w.type === 'w.request.request');
      assert.deepEqual(requests.map((r) => value(r, 'act')), undo ? ['change', 'undo'] : ['change'], output.sop);
      const owned = wires.filter((w) => value(w, 'request') === `$${requests[0].id}`);
      const target = owned.find((w) => w.type === 'w.request.target');
      assert.equal(value(target, 'mode'), 'existing');
      assert.equal(value(target, 'fill'), 'context');
      assert.ok(owned.some((w) => w.type === 'w.request.lookup' && value(w, 'key') === 'thing'));
      const values = owned.filter((w) => w.type === 'w.request.constraint');
      const unreadWires = owned.filter((w) => w.type === 'w.request.unread').map((w) => value(w, 'text'));
      if (unread) {
        assert.deepEqual(unreadWires, [unread], output.sop);
        assert.equal(values.length, 0, output.sop);
        assert.equal(value(owned.find((w) => w.type === 'w.request.unread'), 'note'),
          text.startsWith('Set') ? 'context.set.property' : 'context.make.property');
      } else {
        assert.deepEqual(unreadWires, [], output.sop);
        assert.deepEqual(values.map((w) => ['attribute', 'value', 'key_words', 'phase', 'measure_words'].map((k) => value(w, k))),
          [[attribute, operand, key, 'result', measure ?? '']], output.sop);
      }
      if (families) {
        const proposed = output.proposals.map(({ sop }) => formaliser.verifier.parse(sop));
        const proposedFamilies = proposed.map((proposal) => value(proposal.find((w) => w.type === 'w.request.target'), 'family'));
        assert.equal(new Set(proposedFamilies).size, 2);
        assert.ok(proposedFamilies.every((family) => families.includes(family)));
        assert.ok(proposed.every((proposal) => !proposal.some((w) => w.type === 'w.request.constraint')));
      }
    });
  }
});

test('context property typing preserves literal and object readings', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    ['diagram', 'Make the label Save and Close', 'node.label', 'Save and Close'],
    ['drawing', 'Make the orange red', 'drawn.colour', 'red'],
    ['diagram', 'make all corners rounded', 'node.effect', 'rounded'],
    ['drawing', 'change the time to after sunset', 'page.time', 'sunset'],
  ];
  for (const [tab, text, attribute, operand] of cases) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(output.check?.ok, true, output.sop || output.error);
      const wires = formaliser.verifier.parse(output.sop);
      assert.ok(wires.some((w) => w.type === 'w.request.constraint' && value(w, 'attribute') === attribute &&
        value(w, 'value') === operand), output.sop);
    });
  }
});

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
    ...[
      ['forty five minutes', '45'], ['forty-five minutes', '45'], ['sixty seven minutes', '67'], ['45 minutes', '45', ''],
    ].map(([phrase, amount, words = phrase]) => ['calendar', `Set the duration on the meeting to ${phrase}`, ['change'], 'meeting', '',
      ['meeting.duration', amount, words, amount, 'minute', 'duration'], { measureWords: phrase }]),
    ['diagram', 'Set the width on the node to 15 for 2 minutes', ['change'], 'node', '',
      ['node.width', '15', '', '', '', 'width'], { unread: 'for 2 minutes' }],
    ['diagram', 'Set the width on the node to fifteen pixels for two minutes', ['change'], 'node', '',
      ['node.width', '15', 'fifteen pixels', '15', 'pixel', 'width'], { unread: 'for two minutes' }],
    ['diagram', 'Set the duration on the page to 2 minutes', ['change'], 'page', '',
      ['page.duration', '2', '', '2', 'minute', 'duration']],
    ['diagram', 'Set the height on the chart "Review 2" to seventeen pixels', ['change'], 'chart', '',
      ['chart.height', '17', 'seventeen pixels', '17', 'pixel', 'height'], { name: 'Review 2' }],
    ['diagram', 'Set the width on the node to 15 pixels, then make 2 circles', ['change', 'make'], 'node', '',
      ['node.width', '15', '', '15', 'pixel', 'width'], { nextCount: '2' }],
    ['diagram', 'Set the title on the chart to Build and Plan', ['change'], 'chart', '',
      ['chart.title', 'Build and Plan', '', '', '', 'title']],
  ];
  for (const [tab, text, acts, family, sort, expected, { unread, name, nextCount, measureWords } = {}] of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const target = wires.find((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      const owner = `$${requests[0].id}`;
      const effects = nextCount ? constraints.filter((wire) => value(wire, 'request') === owner) : constraints;
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), acts, result.sop);
      assert.deepEqual(['family', 'mode', 'sort'].map((key) => value(target, key)), [family, 'existing', sort], result.sop);
      assert.deepEqual(effects.map((wire) => ['attribute', 'value', 'words', 'measure', 'unit', 'key_words']
        .map((key) => value(wire, key))), [expected], result.sop);
      assert.equal(value(effects[0], 'phase'), 'result', result.sop);
      assert.equal(value(effects[0], 'request'), owner, result.sop);
      if (measureWords) assert.equal(value(effects[0], 'measure_words'), measureWords, result.sop);
      assert.deepEqual(wires.filter((wire) => wire.type === 'w.request.unread')
        .map((wire) => [value(wire, 'text'), value(wire, 'request')]), unread ? [[unread, owner]] : [], result.sop);
      if (name) assert.equal(value(target, 'name'), name, result.sop);
      if (nextCount) {
        const next = wires.find((wire) => wire.type === 'w.request.target' && value(wire, 'request') === `$${requests[1].id}`);
        assert.equal(value(next, 'count'), nextCount, result.sop);
      }
    });
  }
});
