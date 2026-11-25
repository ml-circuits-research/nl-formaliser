import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormaliser } from '../src/index.mjs';
import { unquoteSop } from '../src/contracts.mjs';
import { buildLattice } from '../src/lattice/candidates.mjs';
import { encodeProblem } from '../src/smt/encode.mjs';

const repeatedOn = 'Set the width on the node on the oval to 15';
const value = (wire, key) => unquoteSop(wire.attrs[key]?.[0] ?? '');

test('property frames retain the owner, landmark and keyed result', async (t) => {
  const formaliser = await createFormaliser();
  const cases = [
    {
      text: 'Set the width on the node under the oval to 15',
      relation: ['node.position', 'below', 'selector', 'under'], landmark: 'oval',
      property: ['node.width', '15', 'result', '', 'width'],
    },
    {
      text: repeatedOn,
      relation: ['node.position', 'on', 'selector'], landmark: 'oval',
      property: ['node.width', '15', 'result', '', 'width'],
    },
    {
      text: 'Set the width on the node to 15',
      property: ['node.width', '15', 'result', '', 'width'],
    },
    {
      text: 'Move the node under the oval', act: 'place',
      relation: ['node.position', 'below', 'result', 'under'], landmark: 'oval',
    },
    {
      text: 'Set the height on the node near the triangle to 20',
      relation: ['node.position', 'near', 'selector'], landmark: 'triangle',
      property: ['node.height', '20', 'result', '', 'height'],
    },
    {
      text: 'Set the colour on the house behind the tree to blue', tab: 'drawing',
      family: 'drawn', sort: 'house', relation: ['drawn.relation', 'behind', 'selector'], landmark: 'tree',
      property: ['drawn.colour', 'blue', 'result', '', 'colour'],
    },
  ];
  for (const { text, tab = 'diagram', act = 'change', family = 'node', sort = '', relation, landmark, property } of cases) {
    await t.test(text, async () => {
      const result = await formaliser.formalise(text, { tab, topK: 3, verify: true });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.check.ok, true, result.sop);
      const wires = formaliser.verifier.parse(result.sop);
      const requests = wires.filter((wire) => wire.type === 'w.request.request');
      const targets = wires.filter((wire) => wire.type === 'w.request.target');
      assert.deepEqual(requests.map((wire) => value(wire, 'act')), [act], result.sop);
      assert.deepEqual(targets.map((wire) => [value(wire, 'family'), value(wire, 'mode'), value(wire, 'sort')]),
        [[family, 'existing', sort]], result.sop);
      if (family === 'node') assert.equal(value(targets[0], 'family_words'), 'node', result.sop);

      const expected = [];
      if (relation) expected.push([...relation.slice(0, 3), relation[3] ?? '', '']);
      if (landmark) expected.push([`${family}.anchor`, landmark, 'selector', '', '']);
      if (property) expected.push(property);
      const constraints = wires.filter((wire) => wire.type === 'w.request.constraint');
      assert.deepEqual(constraints.map((wire) => ['attribute', 'value', 'phase', 'words', 'key_words']
        .map((key) => value(wire, key))), expected, result.sop);
      assert.ok(constraints.every((wire) => value(wire, 'request') === `$${requests[0].id}`), result.sop);
    });
  }

  await t.test('Z3 selects only the second occurrence of on as a spatial cue', async () => {
    const { kb, runner } = formaliser;
    const lattice = buildLattice(repeatedOn, { tab: 'diagram', kb });
    const frame = lattice.frameMatches.find((match) => match.frameName === 'acts.change.property.on');
    assert.equal(frame.propertyOwnerMarker.partAt, 4);
    assert.deepEqual([frame.propertyOwnerMarker.startTok, frame.propertyOwnerMarker.endTok], [3, 3]);
    const encoded = encodeProblem(lattice, { kb });
    const cues = lattice.candidates.filter((candidate) => candidate.needsAnchor && candidate.text === 'on');
    assert.deepEqual([...new Set(cues.map((cue) => cue.startTok))], [3, 6]);
    const solved = await runner.solve(encoded.smtBody, [...encoded.queryVars, `sel_fr_${frame.id}`]);
    assert.equal(solved.ok, true, solved.error);
    const model = solved.solutions[0];
    assert.equal(model.get(`sel_fr_${frame.id}`), true);
    const selectedCues = cues.filter((cue) => model.get(`sel_${cue.id}`));
    assert.deepEqual(selectedCues.map((cue) => [cue.attribute, cue.startTok, cue.endTok]), [['node.position', 6, 6]]);
  });
});
