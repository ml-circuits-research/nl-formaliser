import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const field = (w, key) => unquoteSop(w.attrs[key]?.[0] ?? '');

function assertScope(result, text, scope) {
  const start = text.indexOf(scope);
  assert.deepEqual(result.unresolved, [{ kind: 'directive-prohibition', start, end: start + scope.length, text: scope }]);
}

test('a directive prohibition retains the exact scope without emitting an action', async (t) => {
  const formaliser = await createFormaliser({ withVerifier: false });
  for (const [text, tab] of [
    ['Do not paint the door and the window blue', 'drawing'],
    ['Please don’t remove n4 and n7', 'diagram'],
    ['Do not undo', null],
    ['Do not paint the door blue and paint the window green', 'drawing'],
  ]) {
    await t.test(text, async () => {
      const output = await formaliser.formalise(text, { tab, topK: 2 });
      assert.equal(output.ok, false);
      assert.equal(output.status, 'unknown');
      assert.equal(output.sop, '');
      assert.deepEqual(output.proposals, []);
      assertScope(output, text, text);
    });
  }
});

test('prohibited and independently written directives stay separate in every proposal', async (t) => {
  const formaliser = await createFormaliser();
  for (const [text, tab, scope, allowed] of [
    ['Do not paint the door blue, then paint the window green', 'drawing', 'Do not paint the door blue', [['window', 'green']]],
    ['Paint the door blue; do not paint the window green; paint the house yellow', 'drawing', 'do not paint the window green', [['door', 'blue'], ['house', 'yellow']]],
    ['Do not paint the door blue, then could you paint the window green', 'drawing', 'Do not paint the door blue', [['window', 'green']]],
    ['Do not paint the door blue, paint the window green', 'drawing', 'Do not paint the door blue', [['window', 'green']]],
    ['do nto paint the door blue then paint the window green', null, 'do nto paint the door blue', [['window', 'green']]],
    ['Do not paint the door blue, then paint the window green', null, 'Do not paint the door blue', [['window', 'green']]],
  ]) {
    await t.test(`${tab}: ${text}`, async () => {
      const output = await formaliser.formalise(text, { tab, verify: true, topK: 2, spellcheck: true });
      assert.equal(output.ok, true, output.sop || output.error);
      assert.equal(output.status, 'partial');
      assertScope(output, text, scope);
      const wires = formaliser.verifier.parse(output.sop);
      assert.deepEqual(wires.filter((w) => w.type === 'w.request.target').map((w) => field(w, 'sort')), allowed.map(([sort]) => sort), output.sop);
      assert.deepEqual(wires.filter((w) => w.type === 'w.request.constraint').map((w) => field(w, 'value')), allowed.map(([, result]) => result), output.sop);
      for (const proposal of output.proposals) {
        assertScope(proposal, text, scope);
        assert.equal(formaliser.verifier.check(text, proposal.sop, proposal.tab).ok, true, proposal.sop);
        const requests = formaliser.verifier.parse(proposal.sop).filter((w) => w.type === 'w.request.request');
        assert.equal(requests.length, allowed.length, proposal.sop);
        const discardedOwner = scope.includes('door') ? 'door' : 'window';
        assert.ok(requests.every((w) => field(w, 'words') && !field(w, 'words').includes(discardedOwner)), proposal.sop);
      }
    });
  }
});

test('negative values, quoted names and skipped imperative lookalikes keep their own readings', async () => {
  const formaliser = await createFormaliser();
  const contrast = await formaliser.formalise('Paint the door red, not blue', { tab: 'drawing', verify: true });
  assert.equal(contrast.unresolved, undefined);
  const constraints = formaliser.verifier.parse(contrast.sop).filter((w) => w.type === 'w.request.constraint');
  assert.deepEqual(constraints.map((w) => [field(w, 'value'), field(w, 'want') || 'yes']), [['red', 'yes'], ['blue', 'no']]);

  const named = await formaliser.formalise('Paint the node named "Do Not Use" red', { tab: 'diagram', verify: true });
  assert.equal(named.unresolved, undefined);
  assert.ok(formaliser.verifier.parse(named.sop).some((w) => w.type === 'w.request.target' && field(w, 'name') === 'Do Not Use'));

  const reminder = await formaliser.formalise("Don't forget to save", { tab: 'drawing' });
  assert.equal(reminder.unresolved, undefined);
  assert.match(reminder.sop, /act=save/);
});
