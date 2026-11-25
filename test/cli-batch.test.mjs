import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/formalise.mjs', import.meta.url));
const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 30_000 });
const row = (text) => JSON.stringify({ text });

test('the batch CLI preserves text-only alternatives, native diagnostics and input order', () => {
  const result = run(['--batch', '--json', '--tab', 'auto', '--verify'], [
    row('Make the house blue'),
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
  assert.match(results[0].sop, /value=blue/);
  assert.equal(results[0].check.ok, true);
  assert.ok(results[1].alternatives.length > 0);
  const spatial = results[1].proposals.filter((proposal) => ['drawing', 'diagram'].includes(proposal.tab));
  assert.ok(spatial.length >= 2);
  for (const proposal of spatial) {
    assert.match(proposal.sop, /target=\$\S+ key=thing from=any words=it/);
    assert.match(proposal.sop, /constraint=\$\S+ key=thing from=any words=them/);
    assert.equal(proposal.check.ok, true);
    assert.ok(Array.isArray(proposal.check.warnings));
  }
  for (const result of results) {
    for (const { sop } of result.proposals) assert.doesNotMatch(sop, /w\.request\.(?:previous|context|clock)\b|from=previous\b/);
  }
  assert.equal(results[2].status, 'unknown');
  assert.equal(results[2].ok, false);
  assert.equal(results[2].sop, '');
  assert.match(results[2].unresolved[0].text, /delete it/i);
  assert.deepEqual(results.slice(3, 7).map((result) => [result.ok, result.status, result.line, result.sop]),
    [5, 6, 7, 8].map((line) => [false, 'invalid-input', line, '']));
  assert.equal(results[7].status, 'partial');
  assert.match(results[7].sop, /value=blue/);
  assert.match(results[7].unresolved[0].text, /delete it/i);
  assert.match(results[8].sop, /value=green/);
});

test('batch defaults to auto and rejects the turn option, while single text still defaults to drawing', () => {
  const batch = run(['--batch'], row('Make it blue'));
  assert.ifError(batch.error);
  assert.equal(batch.status, 0, batch.stderr);
  assert.ok(new Set(JSON.parse(batch.stdout).proposals.map((p) => p.tab)).size > 1);

  const history = run(['--batch', '--previous', 'a boat'], row('Make it blue'));
  assert.ifError(history.error);
  assert.equal(history.status, 2);
  assert.equal(history.stdout, '');
  assert.match(history.stderr, /--previous/);

  const single = run(['--json', 'Make the house blue']);
  assert.ifError(single.error);
  assert.equal(single.status, 0, single.stderr);
  const proposal = JSON.parse(single.stdout);
  assert.equal(proposal.tab, 'drawing');
  assert.match(proposal.sop, /value=blue/);
});
