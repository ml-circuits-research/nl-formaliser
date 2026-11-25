import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const field = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');
const local = (wires, type) => wires.filter((wire) => wire.type === `w.request.${type}`);

test('a written result applies independently to each coordinated existing owner', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    ['drawing', 'Paint the door and the window blue', [['drawn', 'door'], ['drawn', 'window']], 'blue', 'eq'],
    ['diagram', 'Paint n4 and n7 light blue', [['node', 'n4'], ['node', 'n7']], 'light blue', 'eq'],
    ['diagram', 'Paint the chart and the node green', [['chart', 'chart'], ['node', 'node']], 'green', 'eq'],
    ['drawing', 'Paint the tree, the door, and the window yellow', [['drawn', 'tree'], ['drawn', 'door'], ['drawn', 'window']], 'yellow', 'eq'],
    ['drawing', 'Make the circle and the square small', [['drawn', 'circle'], ['drawn', 'square']], 'small', 'degree'],
    ['diagram', 'Paint the node named "Plan and Build" and n4 blue', [['node', 'Plan and Build'], ['node', 'n4']], 'blue', 'eq'],
    ['drawing', 'make the hair back and eyebrows and hair front dark brown', [['part', 'hair_back'], ['part', 'eyebrow'], ['part', 'hair_front']], 'dark brown', 'eq'],
  ];
  for (const [tab, text, owners, value, operator] of cases) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab, topK: 2, verify: true });
      assert.equal(output.check?.ok, true, output.sop || output.error);
      const wires = formaliser.verifier.parse(output.sop);
      const requests = local(wires, 'request');
      assert.equal(requests.length, owners.length, output.sop);
      assert.equal(local(wires, 'target').length, owners.length, output.sop);
      assert.equal(local(wires, 'constraint').length, owners.length, output.sop);
      assert.deepEqual(requests.map((r) => field(r, 'predicate')), [text.split(' ')[0], ...owners.slice(1).map(() => '')]);
      assert.deepEqual(output.check.warnings, [], output.sop);
      for (const [i, [family, owner]] of owners.entries()) {
        const request = requests[i];
        assert.equal(field(request, 'act'), 'change');
        assert.equal(field(request, 'words_origin'), 'hull');
        const words = field(request, 'words');
        if (i > 0) {
          assert.ok(words && text.includes(words) && words.endsWith(value), output.sop);
          assert.ok(!words.startsWith(text.split(' ')[0]), output.sop);
        } else {
          assert.equal(words, '');
        }
        const mine = wires.filter((w) => field(w, 'request') === `$${request.id}`);
        const [target] = local(mine, 'target');
        assert.equal(field(target, 'mode'), 'existing');
        assert.equal(field(target, 'family'), family);
        assert.equal(field(target, 'name') || field(target, 'sort') || field(target, 'family_words'), owner);
        const [result] = local(mine, 'constraint');
        assert.match(field(result, 'attribute'), operator === 'degree' ? /\.size$/ : /\.colou?r$/);
        assert.equal(field(result, 'value'), value);
        assert.equal(field(result, 'operator'), operator);
        assert.equal(field(result, 'phase'), 'result');
      }
      assert.ok(output.alternatives.some((sop) => !sop.includes('words_origin=hull')));
    });
  }
});

test('modifiers, conditional or collective scopes, and literal text keep their ordinary reading path', async (t) => {
  const formaliser = await createFormaliser();
  for (const [tab, text] of [
    ['diagram', 'Paint the node red and blue'],
    ['diagram', 'Paint n4 and n7 blue if the chart is empty'],
    ['diagram', 'If the chart is empty, paint n4 and n7 blue'],
    ['diagram', 'Align n4 and n7 horizontally'],
    ['diagram', 'keep Kettle and Sink in a column'],
    ['diagram', 'Keep n4 and n7 in a column'],
    ['diagram', 'Set the title on the chart to "Save and Close"'],
    ['drawing', 'Paint the door red and paint the window blue'],
  ]) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(output.check?.ok, true, output.sop || output.error);
      assert.doesNotMatch(output.sop, /words_origin=hull/);
      if (text.endsWith('red and blue')) {
        const wires = formaliser.verifier.parse(output.sop);
        assert.equal(local(wires, 'request').length, 1);
        assert.deepEqual(local(wires, 'constraint').map((w) => field(w, 'value')), ['red', 'blue']);
      }
      if (text.includes('"')) assert.match(output.sop, /Save and Close/);
    });
  }
  const bounded = await formaliser.formalise('Paint n4 and n7 light blue', { tab: 'diagram', maxRequests: 1 });
  assert.doesNotMatch(bounded.sop, /words_origin=hull/);
});
