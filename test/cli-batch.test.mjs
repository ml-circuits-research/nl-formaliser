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

test('the text-only reader keeps independently coordinated creations and their effects apart', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const doc = await reader.propose('add a heading called Introduction and a paragraph saying Welcome');
    const document = doc.candidates[0];
    assert.equal(document.check.ok, true);
    assert.deepEqual(document.check.warnings, []);
    assert.match(document.sop, /@r1\.c\d+ .*attribute=(?:block|section)\.name value=Introduction\b/);
    assert.match(document.sop, /@r2\.c\d+ .*attribute=section\.content value=Welcome\b/);
    assert.equal((document.sop.match(/predicate=add\b/g) ?? []).length, 1);

    const drawing = (await reader.propose('draw a blue house, a yellow car, and a green tree')).candidates[0];
    assert.equal(drawing.check.ok, true);
    assert.deepEqual(drawing.check.warnings, []);
    for (const [request, sort, colour] of [[1, 'house', 'blue'], [2, 'car', 'yellow'], [3, 'tree', 'green']]) {
      assert.match(drawing.sop, new RegExp(`@r${request}\\.t .*mode=new .*sort=${sort}\\b`));
      assert.match(drawing.sop, new RegExp(`@r${request}\\.c\\d+ .*attribute=drawn.colou?r value=${colour}\\b`));
    }

    const bird = (await reader.propose('add a row of trees in the background and a single bird above them')).candidates[0];
    assert.equal(bird.check.ok, true);
    assert.match(bird.sop, /@r1\.t .*sort=row\b/);
    assert.match(bird.sop, /@r1\.c\d+ .*attribute=part\.owner value=trees\b/);
    assert.match(bird.sop, /@r2\.t .*sort=bird\b/);
    assert.match(bird.sop, /@r2\.l\d+ .*from=any words=them\b/);

    const quoted = (await reader.propose('add a heading called "Save and a Close"')).candidates[0];
    assert.equal(quoted.check.ok, true);
    assert.match(quoted.sop, /value="Save and a Close"/);
    assert.doesNotMatch(quoted.sop, /@r2 w\.request\.request/);

    for (const text of ['draw a farm with a barn and a pond', 'add a page containing a heading and a paragraph']) {
      const result = await reader.propose(text);
      assert.ok(result.candidates.length);
      assert.ok(result.candidates.every(({ sop }) => !sop.includes('words_origin=hull')));
    }

    const explicit = (await reader.propose('draw a house and paint a car blue')).candidates[0];
    assert.equal(explicit.check.ok, true);
    assert.match(explicit.sop, /@r1 .*predicate=draw\b/);
    assert.match(explicit.sop, /@r2 .*predicate=paint\b/);
  } finally {
    await reader.close();
  }
});

test('declared dictation cues bind literal contents without swallowing names or later commands', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const cases = [
      ['Add a heading that says Scope.', 'Scope', 'that says'],
      ['Insert a paragraph that says In the beginning.', '"In the beginning"', 'that says'],
      ['Add a heading that reads "Save and Close".', '"Save and Close"', 'that reads'],
      ['Create a paragraph with the text Welcome back.', '"Welcome back"', 'with the text'],
    ];
    for (const [text, value, cue] of cases) {
      const best = (await reader.propose(text)).candidates[0];
      assert.equal(best.check.ok, true, text);
      assert.ok(['section.content', 'block.text'].some((attribute) =>
        best.sop.includes(`attribute=${attribute} value=${value} operator=eq phase=result key_words="${cue}"`)), best.sop);
    }
    const named = (await reader.propose('Add a heading called Scope.')).candidates[0];
    assert.match(named.sop, /attribute=(?:section|block)\.name value=Scope\b/);
    assert.doesNotMatch(named.sop, /attribute=section\.content\b/);

    const compound = (await reader.propose('Add a page and a heading that says Scope, flush with the top edge')).candidates[0];
    assert.equal(compound.check.ok, true);
    assert.match(compound.sop, /@r2\.c\d+ .*attribute=(?:section\.content|block\.text) value=Scope\b/);
    assert.match(compound.sop, /@r2\.c\d+ .*attribute=section\.order value=top\b/);
    assert.doesNotMatch(compound.sop, /attribute=section\.(?:name|id)\b/);

    const later = (await reader.propose('Add a paragraph that says Welcome and delete the heading')).candidates[0];
    assert.equal(later.check.ok, true);
    assert.match(later.sop, /attribute=(?:section\.content|block\.text) value=Welcome\b/);
    assert.match(later.sop, /@r2 w\.request\.request act=remove\b/);
  } finally {
    await reader.close();
  }
});

test('dictation follows the declared text carrier and keeps an explicit parent separate', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const block = (await reader.propose('insert a paragraph block under Intro that says Main, level 3, and answers to the parent name')).candidates[0];
    assert.equal(block.check.ok, true);
    assert.match(block.sop, /attribute=block\.parent value=Intro\b/);
    assert.match(block.sop, /attribute=block\.text value=Main\b/);
    assert.match(block.sop, /attribute=block\.level value="3"/);
    assert.equal((block.sop.match(/attribute=block\.text\b/g) ?? []).length, 1);

    const box = (await reader.propose('add a text box that says served by the morning crew')).candidates[0];
    assert.equal(box.check.ok, true);
    assert.match(box.sop, /attribute=node\.label value="served by the morning crew"/);
    assert.doesNotMatch(box.sop, /attribute=block\.text\b/);

    const heading = (await reader.propose('start a new page, add a heading box that says Scopa, and put it on the top edge')).candidates[0];
    assert.equal(heading.check.ok, true);
    assert.match(heading.sop, /@r2\.c\d+ .*attribute=node\.label value=Scopa\b/);
    assert.match(heading.sop, /@r3\.l\d+ .*from=any words=it\b/);
  } finally {
    await reader.close();
  }
});
