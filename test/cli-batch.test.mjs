import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReader } from '../src/reader.mjs';

const cli = fileURLToPath(new URL('../bin/formalise.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8', timeout: 30_000 });
const row = (text) => JSON.stringify({ text });

test('the batch CLI preserves text-only alternatives, native diagnostics and input order', () => {
  const result = run(['--batch'], [
    row('Make the house blue and book Ops review'),
    row('Move it next to them'),
    '',
    row('Do not delete it'),
    '{bad json',
    JSON.stringify({ text: 'Make it red', previous: null }),
    JSON.stringify({ text: 'Make it red', context: {} }),
    JSON.stringify({ text: 'Make it red', clock: null }),
    row('Do not delete it, and make the node blue'),
    row('Make the tree green'),
  ].join('\r\n'));
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const results = result.stdout.trimEnd().split('\n').map(JSON.parse);
  assert.equal(results.length, 9);
  for (const result of results) {
    assert.equal(result.engine, 'z3');
    assert.ok(Array.isArray(result.candidates));
    assert.ok(Array.isArray(result.unresolved));
    assert.ok(result.error === null || typeof result.error === 'string');
    assert.ok(!Object.hasOwn(result, 'tab'));
    assert.ok(result.candidates.every((candidate) => !Object.hasOwn(candidate, 'tab')));
  }
  assert.deepEqual(results.map((result) => result.text), [
    'Make the house blue and book Ops review', 'Move it next to them', 'Do not delete it', null, 'Make it red', 'Make it red',
    'Make it red', 'Do not delete it, and make the node blue', 'Make the tree green',
  ]);
  assert.match(results[0].candidates[0].sop, /value=blue/);
  assert.match(results[0].candidates[0].sop, /request=\$r1 family=drawn mode=existing/);
  assert.match(results[0].candidates[0].sop, /request=\$r2 family=meeting mode=new/);
  assert.match(results[0].candidates[0].sop, /request=\$r2 .*attribute=meeting\.title value="Ops review"/);
  assert.equal(results[0].candidates[0].check.ok, true);
  assert.ok(results[1].candidates.length > 1);
  const spatial = results[1].candidates.filter((proposal) => /attribute=(?:drawn\.relation|node\.position)/.test(proposal.sop));
  assert.ok(spatial.some(({ sop }) => /attribute=drawn\.relation/.test(sop)));
  assert.ok(spatial.some(({ sop }) => /attribute=node\.position/.test(sop)));
  for (const proposal of spatial) {
    assert.match(proposal.sop, /target=\$\S+ key=thing from=any words=it/);
    assert.match(proposal.sop, /constraint=\$\S+ key=thing from=any words=them/);
    assert.equal(proposal.check.ok, true);
    assert.ok(Array.isArray(proposal.check.warnings));
  }
  for (const result of results) {
    for (const { sop } of result.candidates) assert.doesNotMatch(sop, /w\.request\.(?:previous|context|clock)\b|from=previous\b/);
  }
  assert.equal(results[2].status, 'unknown');
  assert.equal(results[2].ok, false);
  assert.deepEqual(results[2].candidates, []);
  assert.equal(results[2].error, null);
  assert.match(results[2].unresolved[0].text, /delete it/i);
  assert.deepEqual(results.slice(3, 7).map((result) => [result.ok, result.status, result.line, result.candidates]),
    [5, 6, 7, 8].map((line) => [false, 'invalid-input', line, []]));
  assert.equal(results[7].status, 'partial');
  assert.match(results[7].candidates[0].sop, /value=blue/);
  assert.match(results[7].unresolved[0].text, /delete it/i);
  assert.match(results[8].candidates[0].sop, /value=green/);
});

test('the CLI rejects routing and history options and preserves a written title', () => {
  const routed = run(['--batch', '--tab', 'auto'], row('Make it blue'));
  assert.equal(routed.status, 2);
  assert.equal(routed.stdout, '');
  assert.match(routed.stderr, /--tab/);
  const history = run(['--batch', '--previous', 'a boat'], row('Make it blue'));
  assert.ifError(history.error);
  assert.equal(history.status, 2);
  assert.equal(history.stdout, '');
  assert.match(history.stderr, /--previous/);

  const single = run(['--json', 'Create a node named "Browser tab"']);
  assert.ifError(single.error);
  assert.equal(single.status, 0, single.stderr);
  const proposal = JSON.parse(single.stdout);
  assert.ok(!Object.hasOwn(proposal, 'tab'));
  assert.match(proposal.sop, /value="Browser tab"/);

  const heading = run(['--json', 'Add a heading called Introduction']);
  assert.ifError(heading.error);
  assert.equal(heading.status, 0, heading.stderr);
  const { sop } = JSON.parse(heading.stdout);
  assert.match(sop, /act=make mood=do predicate=Add/);
  assert.match(sop, /family=block mode=new .*family_words=heading/);
  assert.match(sop, /value=Introduction/);
});

test('one Z3 library reader serves multiple text-only proposals before closing', async () => {
  const reader = await createReader();
  try {
    const text = '  Move it next to them ';
    const proposals = reader.propose(text);
    const relative = reader.propose('Set the time to after sunset');
    const closing = reader.close();
    const first = await proposals;
    assert.equal(first.engine, 'z3');
    assert.equal(first.text, text);
    assert.equal(first.error, null);
    assert.ok(first.candidates.some(({ sop }) => /family=drawn/.test(sop)));
    assert.ok(first.candidates.some(({ sop }) => /family=node/.test(sop)));
    for (const candidate of first.candidates) {
      assert.equal(candidate.check.ok, true);
      assert.doesNotMatch(candidate.sop, /w\.request\.(?:previous|context|clock)\b|from=previous\b/);
    }
    const second = await relative;
    const unread = second.unresolved.find((diagnostic) => /after sunset/.test(diagnostic.text));
    assert.ok(unread);
    assert.match(second.candidates[unread.candidate].sop, /w\.request\.unread/);
    await closing;
    const closed = await reader.propose('Make the house blue');
    assert.deepEqual(closed.candidates, []);
    assert.match(closed.error, /closed/i);
  } finally {
    await reader.close();
  }
});
