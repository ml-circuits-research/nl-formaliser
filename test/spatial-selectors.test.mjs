import test from 'node:test';
import assert from 'node:assert/strict';
import { unquoteSop } from '../src/contracts.mjs';
import { createFormaliser } from '../src/index.mjs';
import { buildLattice } from '../src/lattice/candidates.mjs';
import { encodeProblem } from '../src/smt/encode.mjs';

test('lexicalized verbs retain their act and productive re- verbs can use a known stem', async () => {
  const { kb } = await createFormaliser();
  const actsOf = (word) => buildLattice(`${word} the cat`, { kb, tab: 'drawing' }).candidates
    .filter((candidate) => candidate.kind === 'PREDICATE' && candidate.startTok === 0)
    .flatMap((candidate) => candidate.licensed.map(({ act }) => act));
  assert.deepEqual(actsOf('Remove'), ['remove']);
  assert.deepEqual(actsOf('Removed'), ['remove']);
  assert.ok(actsOf('Repaint').includes('change'));
});

test('a verb homonym inside a name does not license a spatial selector', async () => {
  const { kb } = await createFormaliser();
  const lattice = buildLattice('Book Focus Room on Monday', { kb, tab: 'drawing' });
  const regular = encodeProblem(lattice, { kb });
  const disabled = encodeProblem(lattice, { kb, weights: { spatialTargetSelector: 0 } });
  assert.equal(regular.smtBody, disabled.smtBody);
});

const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('spatial predicates distinguish existing targets from placement results', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    {
      text: 'Describe the cat below the bench', tab: 'drawing',
      requests: [{ act: 'ask', family: 'drawn', sort: 'cat', landmark: 'bench' }],
    },
    {
      text: 'Remove the cat under the table', tab: 'drawing',
      requests: [{ act: 'remove', family: 'drawn', sort: 'cat', landmark: 'table' }],
    },
    {
      text: 'Select the node below n4', tab: 'diagram',
      requests: [{ act: 'pick', family: 'node', landmark: 'n4' }],
    },
    {
      text: 'Select the node in front of n7', tab: 'diagram',
      requests: [{ act: 'pick', family: 'node', relation: 'in_front_of', landmark: 'n7' }],
    },
    {
      text: 'Move the node below n4', tab: 'diagram',
      requests: [{ act: 'place', family: 'node', landmark: 'n4' }],
    },
    {
      text: 'Select n4', tab: 'diagram',
      requests: [{ act: 'pick', family: 'node', name: 'n4' }],
    },
    {
      text: 'Select the node below n4, then move the node below n7', tab: 'diagram',
      requests: [
        { act: 'pick', family: 'node', landmark: 'n4' },
        { act: 'place', family: 'node', landmark: 'n7' },
      ],
    },
  ];

  for (const { text, tab, requests: expected } of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), expected.map(({ act }) => act), result.sop);
      assert.equal(targets.length, expected.length, result.sop);
      assert.equal(constraints.length, expected.filter(({ landmark }) => landmark).length * 2, result.sop);

      for (const [i, { act, family, sort = '', name = '', relation = 'below', landmark }] of expected.entries()) {
        const owns = (wire) => value(wire, 'request') === `$${requests[i].id}`;
        const ownedTargets = targets.filter(owns);
        assert.deepEqual(ownedTargets.map((wire) => ['family', 'mode', 'sort', 'name']
          .map((key) => value(wire, key))), [[family, 'existing', sort, name]], result.sop);
        if (family === 'node' && landmark) assert.equal(value(ownedTargets[0], 'family_words'), 'node', result.sop);

        const relationKey = family === 'node' ? 'node.position' : 'drawn.relation';
        const expectedConstraints = landmark ? [
          [`${family}.anchor`, landmark, 'selector'],
          [relationKey, relation, act === 'place' ? 'result' : 'selector'],
        ] : [];
        assert.deepEqual(constraints.filter(owns)
          .map((wire) => ['attribute', 'value', 'phase'].map((key) => value(wire, key)))
          .sort(), expectedConstraints, result.sop);
      }
    });
  }
});
