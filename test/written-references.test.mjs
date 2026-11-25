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

  await t.test('a written part, its owner, and the effect keep separate roles', async () => {
    for (const [text, sort, owner, reference, action, effect, effectValue] of [
      ['Make its roof red', 'roof', 'its', 'its', 'change', 'color', 'red'],
      ['Make her hair shorter', 'hair', 'her', 'her', 'change', 'length', 'less'],
      ['Paint the wing of it blue', 'wing', 'it', 'it', 'change', 'color', 'blue'],
      ['Paint the red roof of the big house blue', 'roof', 'the big house', '', 'change', 'color', 'blue'],
      ['Colour Ava’s sail green', 'sail', 'Ava', '', 'change', 'color', 'green'],
      ['Draw its roof', 'roof', 'its', 'its', 'make', '', ''],
    ]) {
      const { result, wires } = await solve(text, 'drawing');
      assert.deepEqual(result.check.warnings, [], result.sop);
      const [target] = byType(wires, 'target');
      const [request] = byType(wires, 'request');
      const constraints = byType(wires, 'constraint');
      const ownerConstraint = constraints.find((wire) => value(wire, 'attribute') === 'part.owner');
      assert.deepEqual(['family', 'mode', 'sort', 'name'].map((key) => value(target, key)),
        ['part', action === 'make' ? 'new' : 'existing', sort, ''], result.sop);
      assert.equal(value(request, 'act'), action);
      assert.equal(value(ownerConstraint, 'value'), owner);
      assert.equal(value(ownerConstraint, 'phase'), action === 'make' ? 'result' : 'selector');
      if (reference) {
        const [lookup] = byType(wires, 'lookup');
        assert.equal(checkReference(wires, lookup, 'constraint', reference).id, ownerConstraint.id);
      } else {
        assert.deepEqual(byType(wires, 'lookup'), []);
      }
      if (effect) {
        const resultConstraint = constraints.find((wire) => wire !== ownerConstraint && value(wire, 'phase') === 'result');
        assert.equal(value(resultConstraint, 'attribute').replace('colour', 'color'), `part.${effect}`);
        assert.equal(value(resultConstraint, 'value') || value(resultConstraint, 'step'), effectValue);
      }
    }
    for (const text of ['Paint the roof red', 'Move the roof next to the house', 'Change the color of the house to red']) {
      const { wires } = await solve(text, 'drawing');
      assert.equal(value(byType(wires, 'target')[0], 'family'), 'drawn');
      assert.ok(!byType(wires, 'constraint').some((wire) => value(wire, 'attribute') === 'part.owner'));
    }
  });

  await t.test('a shared effect preserves explicit and coordinated possessors', async () => {
    for (const [text, sorts, owners, references] of [
      ['Make its roof and door red', ['roof', 'door'], ['its', 'its'], ['its', 'its']],
      ['Paint her hair and his hair red', ['hair', 'hair'], ['her', 'his'], ['her', 'his']],
      ['Paint the roof of the house and the sail of the boat blue', ['roof', 'sail'], ['the house', 'the boat'], []],
      ['Paint its roof and the tree red', ['roof', 'tree'], ['its'], ['its']],
    ]) {
      const { result, wires } = await solve(text, 'drawing');
      assert.deepEqual(result.check.warnings, [], result.sop);
      assert.deepEqual(byType(wires, 'target').map((wire) => value(wire, 'sort')), sorts);
      const constraints = byType(wires, 'constraint');
      const ownerConstraints = constraints.filter((wire) => value(wire, 'attribute') === 'part.owner');
      assert.deepEqual(ownerConstraints.map((wire) => value(wire, 'value')), owners);
      assert.ok(ownerConstraints.every((wire, i) => value(wire, 'phase') === 'selector' && value(wire, 'request') === `$r${i + 1}`));
      const lookups = byType(wires, 'lookup');
      assert.equal(lookups.length, references.length);
      for (const [i, word] of references.entries()) {
        assert.equal(checkReference(wires, lookups[i], 'constraint', word).id, ownerConstraints[i].id);
      }
      const results = constraints.filter((wire) => value(wire, 'phase') === 'result');
      assert.deepEqual(results.map((wire) => value(wire, 'value')), Array(2).fill(text.split(' ').at(-1)));
    }
  });

  await t.test('explicit property frames keep the complete part owner before the typed results', async () => {
    for (const [text, owner, expected] of [
      ['Set the turn of roof of the house to rotate right', 'the house', [['part.turn', 'rotate_right', 'turn']]],
      ['Set the colour of the red roof of the big house to deep blue', 'the big house', [['part.color', 'deep blue', 'colour']]],
      ['Set the colour of its roof to teal, and the height to 40 pixels, and the width to 60 pixels', 'its', [
        ['part.color', 'teal', 'colour'], ['part.height', '40', 'height'], ['part.width', '60', 'width'],
      ]],
      ['Set the id of roof of the house to Id one and the mirror to horizontal', 'the house', [
        ['part.id', 'Id one', 'id'], ['part.mirror', 'horizontal', 'mirror'],
      ]],
      ['Set the ID of the roof of the house to Save and Close', 'the house', [['part.id', 'Save and Close', 'ID']]],
    ]) {
      const { result, wires } = await solve(text, 'drawing');
      assert.deepEqual(result.check.warnings, [], result.sop);
      assert.equal(byType(wires, 'request').length, 1);
      assert.equal(value(byType(wires, 'target')[0], 'sort'), 'roof');
      const constraints = byType(wires, 'constraint');
      const owners = constraints.filter((wire) => value(wire, 'attribute') === 'part.owner');
      assert.deepEqual(owners.map((wire) => [value(wire, 'value'), value(wire, 'phase')]), [[owner, 'selector']]);
      const changes = constraints.filter((wire) => value(wire, 'phase') === 'result');
      assert.deepEqual(changes.map((wire) => [value(wire, 'attribute').replace('colour', 'color'), value(wire, 'value'), value(wire, 'key_words')]), expected);
      if (owner === 'its') assert.equal(checkReference(wires, byType(wires, 'lookup')[0], 'constraint', 'its').id, owners[0].id);
      if (owner === 'the big house') assert.ok(constraints.some((wire) =>
        /part\.colou?r/.test(value(wire, 'attribute')) && value(wire, 'phase') === 'selector' && value(wire, 'value') === 'red'));
    }

    const { result, wires } = await solve('Set the color of the roof of the house to teal and move the dog left', 'drawing');
    assert.deepEqual(result.check.warnings, [], result.sop);
    assert.deepEqual(byType(wires, 'request').map((wire) => value(wire, 'act')), ['change', 'place']);
    assert.deepEqual(byType(wires, 'target').map((wire) => value(wire, 'sort')), ['roof', 'dog']);
    assert.deepEqual(byType(wires, 'constraint').map((wire) => [value(wire, 'request'), value(wire, 'value')]),
      [['$r1', 'the house'], ['$r1', 'teal'], ['$r2', 'left']]);

    const automatic = await reader.formalise('Set the width of roof of the house to 180 and the height to 90', { tab: null });
    assert.equal(automatic.tab, 'drawing');
    assert.match(automatic.sop, /attribute=part\.owner/);
    assert.ok(automatic.proposals.some((proposal) => proposal.tab !== 'drawing'));
  });
});
