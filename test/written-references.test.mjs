import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');
const byType = (wires, type) => wires.filter((wire) => wire.type === `w.request.${type}`);

function checkReference(wires, lookup, ownerType, words) {
  assert.deepEqual(['key', 'from', 'words'].map((key) => value(lookup, key)), ['thing', 'any', words]);
  const owner = byType(wires, ownerType).find((wire) => `$${wire.id}` === value(lookup, ownerType));
  assert.ok(owner, `Missing ${ownerType} for ${lookup.id}`);
  assert.equal(value(lookup, 'request'), value(owner, 'request'));
  assert.equal(value(lookup, ownerType === 'target' ? 'constraint' : 'target'), '');
  return owner;
}

test('written references keep their roles and their exact evidence', async (t) => {
  const reader = await createFormaliser();
  const solve = async (text, tab) => {
    const result = await reader.formalise(text, { tab, previous: null, verify: true });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.check.ok, true, result.sop);
    const wires = reader.verifier.parse(result.sop);
    assert.deepEqual(byType(wires, 'previous'), []);
    return { result, wires };
  };

  await t.test('object references are unresolved across domains', async () => {
    for (const [text, tab, word, action] of [
      ['Move her below the arch', 'drawing', 'her', 'place'],
      ['Make that one blue', 'diagram', 'that one', 'change'],
      ['Cancel it', 'calendar', 'it', 'remove'],
      ['Make it bold', 'document', 'it', 'change'],
    ]) {
      const { wires } = await solve(text, tab);
      assert.equal(value(byType(wires, 'request')[0], 'act'), action);
      const [lookup] = byType(wires, 'lookup');
      assert.equal(byType(wires, 'lookup').length, 1);
      const target = checkReference(wires, lookup, 'target', word);
      assert.deepEqual(['mode', 'fill', 'name', 'sort'].map((key) => value(target, key)), ['existing', 'context', '', '']);
    }
  });

  await t.test('possessive property owner and result retain their distinct evidence', async () => {
    const { wires } = await solve('Make its width 15 pixels', 'diagram');
    const [lookup] = byType(wires, 'lookup');
    assert.equal(value(checkReference(wires, lookup, 'target', 'its'), 'determiner'), 'possessive');
    const [result] = byType(wires, 'constraint');
    assert.deepEqual(['attribute', 'phase', 'value', 'key_words', 'measure_words'].map((key) => value(result, key)),
      ['node.width', 'result', '15', 'width', '15 pixels']);
  });

  await t.test('a landmark reference belongs to the anchor for either relation phase', async () => {
    for (const [text, word, relation, phase] of [
      ['Move the cat below that one', 'that one', 'below', 'result'],
      ['Paint the cat next to it red', 'it', 'next_to', 'selector'],
    ]) {
      const { wires } = await solve(text, 'drawing');
      const [lookup] = byType(wires, 'lookup');
      assert.equal(byType(wires, 'lookup').length, 1);
      const anchor = checkReference(wires, lookup, 'constraint', word);
      assert.deepEqual(['attribute', 'value', 'phase'].map((key) => value(anchor, key)), ['drawn.anchor', word, 'selector']);
      const constraint = byType(wires, 'constraint').find((wire) => value(wire, 'attribute') === 'drawn.relation');
      assert.deepEqual(['value', 'phase'].map((key) => value(constraint, key)), [relation, phase]);
      assert.equal(value(byType(wires, 'target')[0], 'sort'), 'cat');
    }
  });

  await t.test('scope stays local to each request', async () => {
    const text = 'Paint them blue then move it left';
    const { wires, result } = await solve(text, 'diagram');
    const lookups = byType(wires, 'lookup');
    assert.equal(lookups.length, 2);
    checkReference(wires, lookups[0], 'target', 'them');
    checkReference(wires, lookups[1], 'target', 'it');
    assert.notEqual(value(lookups[0], 'request'), value(lookups[1], 'request'));
    const wrongScope = result.sop.replace('key=thing from=any words=them', 'key=thing from=any words=it');
    assert.equal(reader.verifier.check(text, wrongScope, 'diagram').ok, false);
  });

  await t.test('stitched clauses retain their own constraint lookup IDs', async () => {
    const text = 'Move the big red house next to it; move the little yellow dog below that one; move the blue boat above them; move the green bench near it';
    const { result, wires } = await solve(text, 'drawing');
    assert.equal(result.usedHierarchical, true);
    const lookups = byType(wires, 'lookup');
    assert.equal(lookups.length, 4);
    for (const [i, word] of ['it', 'that one', 'them', 'it'].entries()) {
      const anchor = checkReference(wires, lookups[i], 'constraint', word);
      assert.equal(value(anchor, 'request'), `$r${i + 1}`);
      assert.equal(value(anchor, 'value'), word);
    }
  });

  await t.test('names, determiners and quantity readings retain their roles', async () => {
    const quoted = await solve('Paint the node named "It" blue', 'diagram');
    assert.equal(value(byType(quoted.wires, 'target')[0], 'name'), 'It');
    assert.deepEqual(byType(quoted.wires, 'lookup'), []);
    const demonstrative = await solve('Make that node blue', 'diagram');
    assert.equal(value(byType(demonstrative.wires, 'target')[0], 'family_words'), 'node');
    assert.ok(byType(demonstrative.wires, 'lookup').every((wire) => !value(wire, 'words')));
    const creation = await solve('Make one blue', 'drawing');
    assert.equal(value(byType(creation.wires, 'request')[0], 'act'), 'make');
    assert.deepEqual(byType(creation.wires, 'lookup'), []);
  });
});
