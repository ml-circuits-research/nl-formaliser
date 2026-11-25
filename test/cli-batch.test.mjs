import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReader } from '../src/reader.mjs';
import { loadKnowledge } from '../src/kb/load-worlds.mjs';

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

test('declared selection commands preserve deselection scope and distinguish actual removals', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    for (const text of ['Deselect everything', 'Clear the current selection', "let's remove the selection"]) {
      const best = (await reader.propose(text)).candidates[0];
      assert.equal(best.check.ok, true, text);
      assert.match(best.sop, /act=deselect\b/);
      assert.doesNotMatch(best.sop, /w\.request\.(?:target|lookup)\b/);
      assert.deepEqual(best.check.warnings, []);
    }
    const filtered = (await reader.propose('Deselect the red nodes')).candidates[0];
    assert.equal(filtered.check.ok, true);
    assert.match(filtered.sop, /act=deselect\b/);
    assert.match(filtered.sop, /family=node .*family_words=nodes/);
    assert.match(filtered.sop, /attribute=node\.colou?r value=red operator=eq phase=selector/);
    assert.doesNotMatch(filtered.sop, /name="Deselect the red"/);

    const pronoun = (await reader.propose('Unselect it')).candidates[0];
    assert.match(pronoun.sop, /from=any words=it\b/);

    const removal = (await reader.propose('Delete the selected nodes')).candidates[0];
    assert.match(removal.sop, /act=remove\b/);
    assert.doesNotMatch(removal.sop, /name="Delete the selected"/);

    const combined = (await reader.propose('Clear the selection and make the chart blue')).candidates[0];
    assert.match(combined.sop, /@r1 .*act=deselect\b/);
    assert.match(combined.sop, /@r2 .*act=change\b/);

    const literal = (await reader.propose('Add a text box that says "Clear the selection"')).candidates[0];
    assert.doesNotMatch(literal.sop, /act=deselect\b/);
    assert.match(literal.sop, /attribute=node\.label value="Clear the selection"/);
  } finally {
    await reader.close();
  }
});

test('reported past actions stay distinct from current commands and literal references', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const examples = [
      ['I selected the wrong thing earlier, just remove the selection', 'I selected the wrong thing earlier', 'deselect'],
      ['We made a chart yesterday; add a heading.', 'We made a chart yesterday', 'make'],
      ["I've selected the chart; make it blue.", "I've selected the chart", 'change'],
      ['I have deleted it, undo that.', 'I have deleted it', 'undo'],
    ];
    for (const [text, report, act] of examples) {
      const result = await reader.propose(text);
      assert.equal(result.status, 'partial', text);
      assert.deepEqual(result.unresolved[0], { kind: 'reported-event', start: 0, end: report.length, text: report });
      assert.equal(result.candidates[0].check.ok, true);
      for (const { sop } of result.candidates) {
        assert.deepEqual([...sop.matchAll(/w\.request\.request act=(\S+)/g)].map((match) => match[1]), [act]);
        assert.doesNotMatch(sop, /from=previous|w\.request\.previous/);
      }
      if (act === 'change') assert.match(result.candidates[0].sop, /from=any words=it\b/);
    }

    for (const [text, kind] of [
      ['You deleted the left box and moved the right one.', 'reported-event'],
      ['You deleted the chart?', 'reported-event-question'],
    ]) {
      const result = await reader.propose(text);
      assert.equal(result.status, 'unknown');
      assert.equal(result.error, null);
      assert.equal(result.unresolved[0].kind, kind);
      assert.deepEqual(result.candidates, []);
    }

    const desire = await reader.propose('I hope you can add a chart.');
    assert.ok(desire.candidates.some(({ sop }) => /act=make\b/.test(sop)));
    assert.ok(desire.unresolved.every(({ kind }) => kind !== 'reported-event'));
  } finally {
    await reader.close();
  }
});

test('an explicit chart subject keeps its whole phrase separate from names and chart data', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    for (const [text, topic, family] of [
      ['Create a chart about shipping delays', '"shipping delays"', 'chart'],
      ['Make a treemap about plant groups', '"plant groups"', 'chart'],
      ['Draw a flowchart about refunds', 'refunds', 'diagram'],
      ['Create a chart about costs and revenue', '"costs and revenue"', 'chart'],
    ]) {
      const best = (await reader.propose(text)).candidates[0];
      assert.equal(best.check.ok, true);
      assert.ok(best.sop.includes(`family=${family} mode=new`), best.sop);
      assert.ok(best.sop.includes(`attribute=diagram.about value=${topic} operator=eq phase=result key_words=about`), best.sop);
    }
    const combined = (await reader.propose('could you add a page and a treemap about the linen room?')).candidates[0];
    assert.equal(combined.check.ok, true);
    assert.match(combined.sop, /@r1\.t .*family=page/);
    assert.match(combined.sop, /@r2\.t .*family=chart .*sort=treemap/);
    assert.match(combined.sop, /@r2\.c\d+ .*attribute=diagram\.about value="the linen room"/);
    assert.doesNotMatch(combined.sop, /attribute=(?:chart\.colou?r|page\.scene)/);

    const named = (await reader.propose('Create a chart about shipping delays and title it Incidents')).candidates[0];
    assert.match(named.sop, /attribute=diagram\.about value="shipping delays"/);
    assert.match(named.sop, /name=Incidents|attribute=chart\.(?:title|label) value=Incidents/);

    const title = (await reader.propose('Create a chart titled Shipping delays')).candidates[0];
    assert.match(title.sop, /attribute=chart\.(?:title|label) value="Shipping delays"/);
    assert.doesNotMatch(title.sop, /attribute=diagram\.about/);

    const dimension = (await reader.propose('Show sales by month in a bar chart')).candidates[0];
    assert.match(dimension.sop, /attribute=chart\.(?:dimension|colourBy) value=month/);
    assert.doesNotMatch(dimension.sop, /attribute=diagram\.about/);
  } finally {
    await reader.close();
  }
});

test('declared option questions keep their interrogative role without inventing an object', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    for (const text of [
      'what can i draw',
      'what can u draw',
      'Show me what I can draw.',
      'What can you add to my picture?',
      'Which can I choose?',
    ]) {
      const answer = await reader.propose(text);
      assert.equal(answer.candidates.length, 1, text);
      const best = answer.candidates[0];
      assert.equal(best.check.ok, true);
      assert.deepEqual(best.check.warnings, []);
      assert.match(best.sop, /act=ask mood=ask .*question=list/);
      assert.doesNotMatch(best.sop, /w\.request\.(?:target|lookup)\b/);
    }

    for (const text of [
      'What can I draw, and make the house blue',
      'What can I draw? Make the house blue',
      'Make the house blue. What can I draw?',
    ]) {
      const best = (await reader.propose(text)).candidates[0];
      assert.equal(best.check.ok, true);
      assert.equal((best.sop.match(/w\.request\.request\b/g) ?? []).length, 2);
      assert.match(best.sop, /act=ask mood=ask .*question=list/);
      assert.match(best.sop, /act=change mood=do/);
      assert.match(best.sop, /attribute=drawn\.colou?r value=blue/);
    }

    const indirect = (await reader.propose('Can you draw a cat?')).candidates[0];
    assert.match(indirect.sop, /act=make\b/);
    assert.match(indirect.sop, /sort=cat\b/);
    const title = (await reader.propose('Add a heading called "What can I draw"')).candidates[0];
    assert.match(title.sop, /attribute=(?:section|block)\.name value="What can I draw"/);
    assert.doesNotMatch(title.sop, /act=ask\b/);
  } finally {
    await reader.close();
  }
});

test('declared output operations keep the artifact separate from destination and file form', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const exported = await reader.propose('Export the chart as PDF to Reports then make the node blue');
    assert.equal(exported.status, 'partial');
    const best = exported.candidates[0];
    assert.equal(best.check.ok, true);
    assert.match(best.sop, /@r1 .*act=(?:save|send)\b/);
    assert.match(best.sop, /@r1\.t .*family=chart .*family_words=chart/);
    assert.match(best.sop, /@r1\.i1 w\.request\.intent request=\$r1 role=destination value=Reports words="to Reports"/);
    assert.match(best.sop, /request=\$r1 text="as PDF" note=save\.format/);
    assert.doesNotMatch(best.sop, /name=Reports|sort=file/);
    assert.match(best.sop, /@r2\.c\d+ .*attribute=node\.colou?r value=blue/);

    const download = await reader.propose('Download the drawing as a file');
    assert.equal(download.status, 'partial');
    assert.equal(download.candidates[0].check.ok, true);
    assert.match(download.candidates[0].sop, /(?:sort=drawing|family_words=drawing)/);
    assert.deepEqual(download.unresolved[0], { candidate: 0, text: 'as a file', note: 'save.format' });

    const name = await reader.propose('Save the chart as Draft');
    assert.match(name.candidates[0].sop, /text="as Draft" note=save\.name_or_format/);
    assert.doesNotMatch(name.candidates[0].sop, /name=Draft|w\.request\.intent/);

    const format = await reader.propose('Export the org chart to PDF');
    assert.equal(format.status, 'partial');
    assert.match(format.candidates[0].sop, /text="to PDF" note=save\.destination_or_format/);
    assert.doesNotMatch(format.candidates[0].sop, /role=destination/);

    const localPlacement = await reader.propose('Send the second box to the end');
    assert.ok(localPlacement.candidates.length);
    assert.doesNotMatch(localPlacement.candidates[0].sop, /w\.request\.intent/);

    const pronoun = await reader.propose('Export it to the shared folder');
    assert.equal(pronoun.candidates[0].check.ok, true);
    assert.match(pronoun.candidates[0].sop, /from=any words=it\b/);
    assert.match(pronoun.candidates[0].sop, /role=destination value="the shared folder"/);

    const plain = await reader.propose('Save the drawing');
    assert.match(plain.candidates[0].sop, /act=save\b/);
    assert.doesNotMatch(plain.candidates[0].sop, /w\.request\.intent|note=save\./);
  } finally {
    await reader.close();
  }
});

test('explicit output origins stay separate from named artifacts and destinations', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const exported = await reader.propose('Export the chart from Archive to Reports');
    assert.equal(exported.status, 'partial');
    for (const { sop, check } of exported.candidates) {
      assert.equal(check.ok, true);
      assert.match(sop, /family=chart .*family_words=chart/);
      assert.match(sop, /role=destination value=Reports words="to Reports"/);
      assert.match(sop, /text="from Archive" note=save\.source/);
      assert.doesNotMatch(sop, /name=Archive/);
    }

    const named = (await reader.propose('Export the chart named Archive to Reports')).candidates[0];
    assert.equal(named.check.ok, true);
    assert.match(named.sop, /name=Archive name_words=named/);
    assert.match(named.sop, /role=destination value=Reports/);
    assert.doesNotMatch(named.sop, /note=save\.source/);

    const quotedName = (await reader.propose('Export the chart named "From Archive" to Reports')).candidates[0];
    assert.equal(quotedName.check.ok, true);
    assert.match(quotedName.sop, /name="From Archive"/);
    assert.doesNotMatch(quotedName.sop, /note=save\.source/);

    const quotedOrigin = await reader.propose('Export the chart from "Drafts and Notes" to Reports');
    assert.equal(quotedOrigin.candidates[0].check.ok, true);
    assert.ok(quotedOrigin.unresolved.some(({ candidate, text, note }) =>
      candidate === 0 && text === 'from "Drafts and Notes"' && note === 'save.source'));

    const download = await reader.propose('Download the drawing from the shared folder as a file');
    assert.equal(download.candidates[0].check.ok, true);
    assert.deepEqual(download.unresolved.filter(({ candidate }) => candidate === 0).map(({ text, note }) => [text, note]), [
      ['from the shared folder', 'save.source'],
      ['as a file', 'save.format'],
    ]);
  } finally {
    await reader.close();
  }
});

test('modal artifact requests keep polite delivery and permission readings without guessing the file form', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    for (const [text, artifact, fileForm] of [
      ['can i have the drawing as a file', /(?:sort|family_words)=drawing\b/, 'as a file'],
      ['Could I have the chart as a file to Reports?', /family_words=chart\b/, 'as a file'],
      ['May I have the diagram as an image file?', /family_words=diagram\b/, 'as an image file'],
    ]) {
      const result = await reader.propose(text);
      assert.equal(result.status, 'partial');
      assert.deepEqual(result.candidates.map(({ sop }) => sop.match(/w\.request\.request act=(\S+)/)?.[1]),
        ['save', 'ask']);
      assert.match(result.candidates[1].sop, /act=ask mood=check/);
      for (const { sop, check } of result.candidates) {
        assert.equal(check.ok, true);
        assert.match(sop, artifact);
        assert.doesNotMatch(sop, /question=|\bname=|sort=file\b/);
        assert.ok(sop.includes(`text="${fileForm}" note=save.format`), sop);
        if (text.includes('Reports')) assert.match(sop, /role=destination value=Reports/);
        else assert.doesNotMatch(sop, /role=destination/);
      }
    }

    const pronoun = (await reader.propose('Could we have it as a file to Reports?')).candidates[0];
    assert.equal(pronoun.check.ok, true);
    assert.match(pronoun.sop, /act=save mood=do predicate="Could we have"/);
    assert.match(pronoun.sop, /from=any words=it\b/);
    assert.match(pronoun.sop, /role=destination value=Reports/);
    assert.match(pronoun.sop, /text="as a file" note=save\.format/);
    assert.doesNotMatch(pronoun.sop, /name="Could we"|sort=file/);

    const ordinary = (await reader.propose('Can you draw a cat?')).candidates[0];
    assert.match(ordinary.sop, /act=make\b/);
    assert.match(ordinary.sop, /sort=cat\b/);

    const otherUse = await reader.propose('Can I have a blue circle?');
    assert.ok(otherUse.candidates.every(({ sop }) => !sop.includes('note=save.format')));

    const quoted = (await reader.propose('Add a heading called "Can I have the drawing as a file?"')).candidates[0];
    assert.match(quoted.sop, /value="Can I have the drawing as a file\?"/);
    assert.doesNotMatch(quoted.sop, /act=save\b/);
  } finally {
    await reader.close();
  }
});

test('file and copy requests retain untyped references and distinguish modal question subjects', async () => {
  const reader = await createReader();
  try {
    for (const [text, pronoun, acts] of [
      ['Save it to Reports', 'it', ['save']],
      ['Copy it', 'it', ['copy']],
      ['Could we have it as a file to Reports?', 'it', ['save', 'ask']],
      ['Could she have it as a file?', 'it', ['ask']],
      ['Can he have that one as a file?', '"that one"', ['ask']],
    ]) {
      const result = await reader.propose(text);
      if (text.includes('as a file')) assert.equal(result.status, 'partial');
      assert.deepEqual(result.candidates.map(({ sop }) => sop.match(/w\.request\.request act=(\S+)/)?.[1]), acts);
      for (const { sop, check } of result.candidates) {
        assert.ok(check.ok, sop);
        assert.match(sop, /\brefers=thing\b/);
        assert.ok(sop.includes(`w.request.lookup request=$r1 key=thing from=any words=${pronoun}`), sop);
        if (text.includes('as a file')) assert.match(sop, /text="as a file" note=save\.format/);
        assert.doesNotMatch(sop, /w\.request\.target|from=previous/);
        if (sop.includes('act=ask')) assert.match(sop, /act=ask mood=check/);
        if (text.includes('Reports')) assert.match(sop, /role=destination value=Reports/);
      }
    }

    const typed = await reader.propose('May they have the diagram as an image file?');
    assert.ok(typed.candidates.length);
    for (const { sop, check } of typed.candidates) {
      assert.ok(check.ok, sop);
      assert.match(sop, /act=ask mood=check predicate="May they have"/);
      assert.match(sop, /family=diagram .*family_words=diagram/);
      assert.match(sop, /text="as an image file" note=save\.format/);
    }

    const named = (await reader.propose('Could we have the chart called It as a file?')).candidates[0];
    assert.match(named.sop, /family=chart .*name=It\b/);

    const quoted = (await reader.propose('Could we have the chart called "it" as a file?')).candidates[0];
    assert.match(quoted.sop, /family=chart .*name=it\b/);
    assert.doesNotMatch(quoted.sop, /\brefers=thing\b/);
  } finally {
    await reader.close();
  }
});

test('modal wants bind an explicit new object or an existing property owner without naming the request lead', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const circle = (await reader.propose('Can I have a blue circle?')).candidates[0];
    assert.equal(circle.check.ok, true);
    assert.match(circle.sop, /act=make mood=do predicate="Can I have"/);
    assert.match(circle.sop, /mode=new .*sort=circle/);
    assert.match(circle.sop, /attribute=(?:drawn|node)\.colou?r value=blue/);
    assert.doesNotMatch(circle.sop, /name="Can I"/);

    const heading = (await reader.propose('Could I have a heading named Scope?')).candidates[0];
    assert.match(heading.sop, /act=make mood=do predicate="Could I have"/);
    assert.match(heading.sop, /attribute=(?:section|block)\.name value=Scope/);

    const chart = (await reader.propose('Could I have the chart red?')).candidates[0];
    assert.equal(chart.check.ok, true);
    assert.match(chart.sop, /act=change mood=do predicate="Could I have"/);
    assert.match(chart.sop, /family=chart mode=existing/);
    assert.match(chart.sop, /attribute=chart\.colou?r value=red/);
    assert.doesNotMatch(chart.sop, /name="Could I"/);

    const axis = (await reader.propose('Can we have the x axis on the sales chart flipped, since the chart has to match the deck template')).candidates[0];
    assert.equal(axis.check.ok, true);
    assert.match(axis.sop, /family=chart mode=existing/);
    assert.match(axis.sop, /attribute=chart\.invert value=x/);
    assert.doesNotMatch(axis.sop, /attribute=page\.style/);

    const sort = (await reader.propose('Can we have it largest to smallest, because the numbers in the sheet are still moving')).candidates[0];
    assert.equal(sort.check.ok, true);
    assert.match(sort.sop, /from=any words=it\b/);
    assert.match(sort.sop, /attribute=chart\.sort value=desc/);

    const file = (await reader.propose('Can I have the drawing as a file?')).candidates[0];
    assert.match(file.sop, /act=save\b/);
    assert.match(file.sop, /text="as a file" note=save\.format/);
  } finally {
    await reader.close();
  }
});

test('chart axis fields and axis titles keep their respective values and owners', async () => {
  const reader = await createReader({ topK: 2 });
  try {
    const modal = (await reader.propose('Can we have Orders on the y axis of the Revenue by region chart, because the numbers in the sheet are still moving')).candidates[0];
    assert.equal(modal.check.ok, true);
    assert.match(modal.sop, /act=change mood=do .*predicate="Can we have"/);
    assert.match(modal.sop, /family=chart .*description="the Revenue by region chart"/);
    assert.match(modal.sop, /attribute=chart\.yField value=Orders operator=eq phase=result/);
    assert.doesNotMatch(modal.sop, /family=drawn|name=Orders/);

    const named = (await reader.propose('Put Revenue on the y axis of Monthly sales, and show the values on the chart.')).candidates[0];
    assert.equal(named.check.ok, true);
    assert.match(named.sop, /@r1\.t .*name="Monthly sales"/);
    assert.match(named.sop, /@r1\.c\d+ .*attribute=chart\.yField value=Revenue operator=eq phase=result/);
    assert.match(named.sop, /@r2 w\.request\.request .*predicate=show/);
    assert.match(named.sop, /@r2\.c\d+ .*attribute=chart\.show_values value=show .*phase=result/);
    assert.doesNotMatch(named.sop, /attribute=page\.style|fill=journal_step|from=previous/);

    const both = (await reader.propose('Put profit on the horizontal axis and sales on the y-axis')).candidates[0];
    assert.equal(both.check.ok, true);
    assert.match(both.sop, /@r1\.c\d+ .*attribute=chart\.xField value=profit/);
    assert.match(both.sop, /@r1\.c\d+ .*attribute=chart\.yField value=sales/);

    const title = (await reader.propose('Now set the y axis title on Monthly sales to Sales.')).candidates[0];
    assert.equal(title.check.ok, true);
    assert.match(title.sop, /name="Monthly sales"/);
    assert.match(title.sop, /attribute=chart\.yLabel value=Sales operator=eq phase=result/);
    assert.doesNotMatch(title.sop, /attribute=chart\.(?:yField|invert)/);

    const pronoun = (await reader.propose('Put Revenue on the y axis of it')).candidates[0];
    assert.equal(pronoun.check.ok, true);
    assert.match(pronoun.sop, /from=any words=it\b/);
    assert.doesNotMatch(pronoun.sop, /name=it\b/);

    for (const text of ['Put the legend on the x axis', 'Could you set the y axis to linear?']) {
      const result = await reader.propose(text);
      assert.ok(result.candidates.every(({ sop }) => !/attribute=chart\.[xy]Field\b/.test(sop)));
    }
  } finally {
    await reader.close();
  }
});

test('chart display edits bind label and grid visibility separately from grid style', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    for (const [text, effect, owner] of [
      ['Hide the data labels on Monthly sales.', /chart\.show_values value=hide/, /name="Monthly sales"/],
      ['Hide the grid on the chart.', /chart\.grid value=hide/, /description="the chart"/],
      ['Can I have the gridlines dotted on the chart?', /chart\.gridStyle value=dotted/, /description="the chart"/],
      ["I'd like the grid lines dashed on the profit chart", /chart\.gridStyle value=dashed/, /description="the profit chart"/],
      ['The grid lines on Monthly profit should be dashed.', /chart\.gridStyle value=dashed/, /name="Monthly profit"/],
      ['Grid lines dashed', /chart\.gridStyle value=dashed/, /key=thing from=any/],
      ['Set the gridline style of it to solid.', /chart\.gridStyle value=solid/, /from=any words=it\b/],
    ]) {
      const { sop, check } = (await reader.propose(text)).candidates[0];
      assert.ok(check.ok, sop);
      assert.match(sop, effect);
      assert.match(sop, owner);
      assert.match(sop, /phase=result/);
      assert.doesNotMatch(sop, /attribute=page\.style|fill=journal_step|from=previous/);
      if (effect.source.includes('gridStyle')) assert.doesNotMatch(sop, /attribute=chart\.grid(?:lines)? /);
    }

    const compound = (await reader.propose('Create a bar chart of sales; and show the values on it.')).candidates[0];
    assert.ok(compound.check.ok, compound.sop);
    assert.match(compound.sop, /@r2\.l\d+ .*from=any words=it/);
    assert.match(compound.sop, /@r2\.c\d+ .*chart\.show_values value=show/);
    assert.doesNotMatch(compound.sop, /attribute=page\.style|from=previous/);

    for (const text of ['Show the values in the spreadsheet.', 'Draw boxes on a grid.']) {
      const result = await reader.propose(text);
      assert.ok(result.candidates.length);
      assert.doesNotMatch(result.candidates[0].sop, /attribute=chart\.(?:show_values|grid|gridStyle)\b/);
    }
  } finally {
    await reader.close();
  }
});

test('chart stroke edits preserve slot-owned open literals and keep dependent wording separate', async () => {
  const kb = await loadKnowledge({ includeLegacy: false });
  const closedGridStroke = kb.catalog.keys.get('chart.gridStyle').values.has('dash_dot');
  const reader = await createReader({ topK: 1 });
  try {
    const cases = [
      ['Can we have dash-dot gridlines on the sales chart, so the reviewer can see the pattern without the table',
        /description="the sales chart"/, /text="so the reviewer can see the pattern without the table"/],
      ['Try the grid line style dash-dot', /predicate=Try/, null],
      ['Dash-dot gridlines', /key=thing from=any/, null],
    ];
    for (const [text, owner, qualifier] of cases) {
      const result = await reader.propose(text);
      const { sop, check } = result.candidates[0];
      assert.ok(check.ok, sop);
      assert.match(sop, owner);
      if (qualifier) assert.match(sop, qualifier);
      assert.equal(result.status, qualifier ? 'partial' : 'sat');
      if (closedGridStroke) {
        assert.match(sop, /attribute=chart\.gridStyle value=dash_dot .*phase=result/);
        assert.doesNotMatch(sop, /open_value=true/);
      } else {
        assert.match(sop, /attribute=chart\.gridStyle value=[Dd]ash-dot .*phase=result open_value=true/);
      }
      assert.doesNotMatch(sop, /attribute=(?:chart\.(?:grid|gridlines|lineStyle)|diagram\.kind)\b/);
    }

    const line = (await reader.propose('Set the line style on Monthly sales to dash dot')).candidates[0];
    assert.ok(line.check.ok, line.sop);
    assert.match(line.sop, /name="Monthly sales"/);
    assert.match(line.sop, /attribute=chart\.lineStyle value=dash_dot words="dash dot" .*phase=result/);
    assert.doesNotMatch(line.sop, /open_value|attribute=chart\.grid/);

    const compound = (await reader.propose('Can we have dashed grid lines on sales chart, so the reviewer can see it, then draw a cat.')).candidates[0];
    assert.ok(compound.check.ok, compound.sop);
    assert.match(compound.sop, /@r1\.c\d+ .*chart\.gridStyle value=dashed/);
    assert.match(compound.sop, /@r1\.u\d+ .*text="so the reviewer can see it"/);
    assert.match(compound.sop, /@r2\.t .*sort=cat/);
  } finally {
    await reader.close();
  }
});

test('chart axis edits bind closed positions and value-axis scales without inventing an owner', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    for (const [text, result, owner] of [
      ['Switch the y axis to log', /chart\.axisScale value=log/, /key=thing from=any/],
      ['The y axis scale should be log', /chart\.axisScale value=log/, /key=thing from=any/],
      ['Put the x axis on the top', /chart\.xAxis value=top/, /key=thing from=any/],
      ['Y axis on the right', /chart\.axisSide value=right/, /key=thing from=any/],
      ['Move the y-axis on Monthly sales to the left', /chart\.axisSide value=left/, /name="Monthly sales"/],
      ['Set the axis scale on Annual print and digital sales to logarithmic', /chart\.axisScale value=log words=logarithmic/,
        /name="Annual print and digital sales"/],
      ['Put the y axis of it on the left', /chart\.axisSide value=left/, /from=any words=it\b/],
    ]) {
      const { sop, check } = (await reader.propose(text)).candidates[0];
      assert.ok(check.ok, sop);
      assert.match(sop, /act=change mood=do/);
      assert.match(sop, /family=chart mode=existing/);
      assert.match(sop, result);
      assert.match(sop, owner);
      if (text.endsWith('logarithmic')) {
        assert.ok(!check.uncoveredWords.includes('logarithmic'), JSON.stringify(check));
      }
      assert.doesNotMatch(sop, /\bname=[xy]\b|open_value|attribute=chart\.[xy]Field|attribute=page\.style/);
    }

    const compound = (await reader.propose('Y axis scale log. Show grid lines.')).candidates[0];
    assert.ok(compound.check.ok, compound.sop);
    assert.match(compound.sop, /@r1\.c\d+ .*chart\.axisScale value=log/);
    assert.match(compound.sop, /@r2\.c\d+ .*chart\.grid value=show/);
  } finally {
    await reader.close();
  }
});

test('chart value-axis limits preserve numeric roles, evidence and creation ownership', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    for (const [text, result] of [
      ['Start the y axis at ten', /chart\.yMin value="10" words=ten .*phase=result/],
      ['Cap the axis at 50', /chart\.yMax value="50" .*phase=result/],
      ['Make the y axis zero-based', /chart\.yMin value="0" words=zero-based .*phase=result/],
      ['Zero based value axis on the chart', /chart\.yMin value="0" words="Zero based" .*phase=result/],
    ]) {
      const { sop, check } = (await reader.propose(text)).candidates[0];
      assert.ok(check.ok, sop);
      assert.match(sop, /family=chart mode=existing/);
      assert.match(sop, result);
      assert.doesNotMatch(sop, /attribute=(?:chart\.(?:errorCap|yLabel)|meeting\.)/);
    }

    const range = (await reader.propose('Set the value axis from -12.5 to 50 on Monthly sales')).candidates[0];
    assert.ok(range.check.ok, range.sop);
    assert.match(range.sop, /name="Monthly sales"/);
    assert.match(range.sop, /@r1\.c\d+ .*chart\.yMin value="-12\.5" .*phase=result/);
    assert.match(range.sop, /@r1\.c\d+ .*chart\.yMax value="50" .*phase=result/);

    const creation = (await reader.propose('Create a bar chart of 2023 sales, with a zero-based y-axis; then draw a cat')).candidates[0];
    assert.ok(creation.check.ok, creation.sop);
    assert.match(creation.sop, /@r1\.t .*family=chart mode=new/);
    assert.match(creation.sop, /@r1\.c\d+ .*chart\.yMin value="0" words=zero-based .*phase=result/);
    assert.match(creation.sop, /@r2\.t .*sort=cat/);
    assert.doesNotMatch(creation.sop, /attribute=composition\.with/);

    for (const text of ['Start the meeting at ten', 'Make the x axis zero-based',
      'Add a heading called "with a zero-based y axis"']) {
      const { sop, check } = (await reader.propose(text)).candidates[0];
      assert.ok(check.ok, sop);
      assert.doesNotMatch(sop, /attribute=chart\.(?:yMin|yMax)\b/);
    }
  } finally {
    await reader.close();
  }
});

test('distinct X-axis scale wording remains unresolved alongside supported Y-scale results', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    const simple = await reader.propose('Set the x axis to logarithmic');
    assert.equal(simple.status, 'partial');
    assert.ok(simple.candidates[0].check.ok);
    assert.match(simple.candidates[0].sop, /text="x axis to logarithmic" note="x-axis scale"/);
    assert.doesNotMatch(simple.candidates[0].sop, /attribute=chart\.(?:xAxis|axisScale|xLabel)/);

    const named = await reader.propose('Set the x-axis scale on Regional sales to logarithmic. Then draw a cat.');
    assert.equal(named.status, 'partial');
    assert.ok(named.candidates[0].check.ok);
    assert.match(named.candidates[0].sop, /@r1\.t .*name="Regional sales"/);
    assert.match(named.candidates[0].sop, /@r1\.u\d+ .*text="x-axis scale" note="x-axis scale"/);
    assert.match(named.candidates[0].sop, /@r1\.u\d+ .*text=logarithmic note="x-axis scale"/);
    assert.match(named.candidates[0].sop, /@r2\.t .*sort=cat/);

    const pair = await reader.propose('Set the x axis to linear and the y axis to logarithmic on Regional sales');
    assert.equal(pair.status, 'partial');
    assert.ok(pair.candidates[0].check.ok);
    assert.match(pair.candidates[0].sop, /name="Regional sales"/);
    assert.match(pair.candidates[0].sop, /text="x axis to linear" note="x-axis scale"/);
    assert.match(pair.candidates[0].sop, /chart\.axisScale value=log words=logarithmic/);
    assert.doesNotMatch(pair.candidates[0].sop, /attribute=chart\.(?:xAxis|xLabel|yLabel)/);

    const separate = await reader.propose('Keep the x axis linear with keep the y axis logarithmic, and make the markers a bit bigger');
    assert.equal(separate.status, 'partial');
    assert.ok(separate.candidates[0].check.ok);
    assert.match(separate.candidates[0].sop, /@r1\.u\d+ .*text="x axis linear" note="x-axis scale"/);
    assert.match(separate.candidates[0].sop, /@r1\.c\d+ .*chart\.axisScale value=log/);
    assert.match(separate.candidates[0].sop, /@r2\.c\d+ .*chart\.markerSize/);

    const quoted = (await reader.propose('Leave the chart called "X axis linear"')).candidates[0];
    assert.ok(quoted.check.ok, quoted.sop);
    assert.match(quoted.sop, /name="X axis linear"/);
    assert.doesNotMatch(quoted.sop, /note="x-axis scale"/);
  } finally {
    await reader.close();
  }
});

test('chart legend requests retain visibility, scoped position and the chart owner', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    for (const [text, effect, who] of [
      ['Add a legend to the Sales by month chart', 'show', /description="the Sales by month chart"/],
      ['Remove the legend from Quarterly sales', 'hide', /name="Quarterly sales"/],
      ['Drop the legend on the right', 'right', /key=thing from=any/],
      ['Put the legend on the left side of the Expenses by department chart', 'left',
        /description="the Expenses by department chart"/],
      ['Set the legend on Quarterly sales to the bottom', 'bottom', /name="Quarterly sales"/],
      ['Move the legend of it to the top', 'top', /from=any words=it\b/],
    ]) {
      const { sop, check } = (await reader.propose(text)).candidates[0];
      assert.ok(check.ok, sop);
      assert.match(sop, /act=change mood=do/);
      assert.match(sop, /family=chart mode=existing/);
      assert.match(sop, who);
      assert.match(sop, new RegExp(`attribute=chart\\.legend value=${effect} .*phase=result`));
      assert.doesNotMatch(sop, /attribute=(?:page\.style|chart\.showLegend)|name="the (?:right|left)"/);
    }

    const creation = (await reader.propose('Create a bar chart of 2023 sales, with a zero-based y-axis, legend at the bottom; then draw a cat')).candidates[0];
    assert.ok(creation.check.ok, creation.sop);
    assert.match(creation.sop, /@r1\.t .*family=chart mode=new/);
    assert.match(creation.sop, /@r1\.c\d+ .*chart\.legend value=bottom/);
    assert.match(creation.sop, /@r1\.c\d+ .*chart\.yMin value="0"/);
    assert.match(creation.sop, /@r2\.t .*sort=cat/);

    const excluded = (await reader.propose('Create a bar chart of sales without a legend')).candidates[0];
    assert.ok(excluded.check.ok, excluded.sop);
    assert.match(excluded.sop, /chart\.legend value=hide words="without a legend"/);

    const combined = (await reader.propose('Hide the legend on the Expenses by department chart and the values as well')).candidates[0];
    assert.ok(combined.check.ok, combined.sop);
    assert.match(combined.sop, /description="the Expenses by department chart"/);
    assert.match(combined.sop, /@r1\.c\d+ .*chart\.legend value=hide/);
    assert.match(combined.sop, /@r1\.c\d+ .*chart\.show_values value=hide/);

    const sharedOwner = (await reader.propose('Show the legend and values on Quarterly sales')).candidates[0];
    assert.ok(sharedOwner.check.ok, sharedOwner.sop);
    assert.match(sharedOwner.sop, /name="Quarterly sales"/);
    assert.match(sharedOwner.sop, /@r1\.c\d+ .*chart\.legend value=show/);
    assert.match(sharedOwner.sop, /@r1\.c\d+ .*chart\.show_values value=show/);

    const quoted = (await reader.propose('Add a heading called "legend at the bottom"')).candidates[0];
    assert.ok(quoted.check.ok, quoted.sop);
    assert.match(quoted.sop, /value="legend at the bottom"/);
    assert.doesNotMatch(quoted.sop, /attribute=chart\.legend/);
  } finally {
    await reader.close();
  }
});

test('chart field roles distinguish primary grouping, series and colour encoding', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    const combined = (await reader.propose('Create a bar chart of sales by month, coloured by region and split by customer segment')).candidates[0];
    assert.ok(combined.check.ok, combined.sop);
    assert.match(combined.sop, /family=chart mode=new/);
    assert.match(combined.sop, /chart\.dimension value=month .*phase=result/);
    assert.match(combined.sop, /chart\.colourBy value=region .*phase=result/);
    assert.match(combined.sop, /chart\.seriesDimension value="customer segment" .*phase=result/);
    assert.doesNotMatch(combined.sop, /chart\.colour value=coloured|chart\.dimension value=region/);

    const fragment = (await reader.propose('line chart of sales by month, split by category')).candidates[0];
    assert.ok(fragment.check.ok, fragment.sop);
    assert.match(fragment.sop, /family=chart mode=new/);
    assert.match(fragment.sop, /chart\.dimension value=month .*phase=result/);
    assert.match(fragment.sop, /chart\.seriesDimension value=category .*phase=result/);

    const repeated = (await reader.propose('line chart of sales by month, split by category and and use a colour-blind-safe palette')).candidates[0];
    assert.ok(repeated.check.ok, repeated.sop);
    assert.match(repeated.sop, /chart\.seriesDimension value=category .*phase=result/);

    const owner = (await reader.propose('Split the Sales by Month chart by category')).candidates[0];
    assert.ok(owner.check.ok, owner.sop);
    assert.match(owner.sop, /act=change/);
    assert.match(owner.sop, /description="the Sales by Month chart"/);
    assert.match(owner.sop, /chart\.seriesDimension value=category .*phase=result/);

    const colour = (await reader.propose('Colour the chart by "Research and Development"; then draw a cat')).candidates[0];
    assert.ok(colour.check.ok, colour.sop);
    assert.match(colour.sop, /@r1\.c\d+ .*chart\.colourBy value="Research and Development"/);
    assert.match(colour.sop, /@r2\.t .*sort=cat/);

    const distribution = (await reader.propose('Draw me a bar chart showing how the stations split by network')).candidates[0];
    assert.ok(distribution.check.ok, distribution.sop);
    assert.match(distribution.sop, /diagram\.about value="the stations"/);
    assert.match(distribution.sop, /chart\.dimension value=network/);
    assert.doesNotMatch(distribution.sop, /chart\.seriesDimension|page\.scene/);

    const ordinary = (await reader.propose('Split the paragraph by headings')).candidates[0];
    assert.ok(ordinary.check.ok, ordinary.sop);
    assert.match(ordinary.sop, /act="take apart"/);
    assert.doesNotMatch(ordinary.sop, /attribute=chart\.seriesDimension/);
  } finally {
    await reader.close();
  }
});

test('scatter against binds both written axes and keeps chart qualifiers separate', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    const fields = (await reader.propose('Display profit against sales, coloured by region in a scatter plot')).candidates[0];
    assert.ok(fields.check.ok, fields.sop);
    assert.match(fields.sop, /family=chart mode=new/);
    assert.match(fields.sop, /@r1\.c\d+ .*chart\.yField value=profit .*phase=result/);
    assert.match(fields.sop, /@r1\.c\d+ .*chart\.xField value=sales .*phase=result/);
    assert.match(fields.sop, /@r1\.c\d+ .*chart\.colourBy value=region/);
    assert.doesNotMatch(fields.sop, /chart\.dimension value=sales|chart\.measure value=profit/);

    const restricted = await reader.propose('Make a scatter plot of profit plotted against sales for the north region only');
    assert.equal(restricted.status, 'partial');
    const qualified = restricted.candidates[0];
    assert.ok(qualified.check.ok, qualified.sop);
    assert.match(qualified.sop, /chart\.xField value=sales [^\n]+key_words="plotted against"/);
    assert.match(qualified.sop, /text="for the north region only" note="scatter qualifier"/);
    assert.doesNotMatch(qualified.sop, /chart\.measure value="north region only"/);

    const quoted = (await reader.propose('Create a scatter plot of "Profit and Margin" against "Net sales"; then draw a dog')).candidates[0];
    assert.ok(quoted.check.ok, quoted.sop);
    assert.match(quoted.sop, /@r1\.c\d+ .*chart\.yField value="Profit and Margin"/);
    assert.match(quoted.sop, /@r1\.c\d+ .*chart\.xField value="Net sales"/);
    assert.match(quoted.sop, /@r2\.t .*sort=dog/);

    const other = (await reader.propose('Create a bar chart of profit against sales')).candidates[0];
    assert.ok(other.check.ok, other.sop);
    assert.doesNotMatch(other.sop, /attribute=chart\.[xy]Field/);
  } finally {
    await reader.close();
  }
});

test('hierarchical segmentation retains a dependent read clause on its chart edit', async () => {
  const reader = await createReader({ topK: 1 });
  try {
    const dependent = await reader.propose('Put the legend on the left side of the Revenue by region chart, so the manager can read it, then draw a dog.');
    assert.equal(dependent.status, 'partial');
    const result = dependent.candidates[0];
    assert.ok(result.check.ok, result.sop);
    assert.match(result.sop, /@r1\.t .*description="the Revenue by region chart"/);
    assert.match(result.sop, /@r1\.c\d+ .*chart\.legend value=left words="left side"/);
    assert.match(result.sop, /@r1\.u\d+ .*text="so the manager can read it"/);
    assert.match(result.sop, /@r2\.t .*sort=dog/);
    assert.doesNotMatch(result.sop, /act=load|@r3 w\.request/);

    const independent = (await reader.propose('Put the legend on the left side of the Revenue by region chart, then read the Sales report, then draw a dog.')).candidates[0];
    assert.ok(independent.check.ok, independent.sop);
    assert.match(independent.sop, /@r2 w\.request\.request act=load .*predicate=read/);
    assert.match(independent.sop, /@r3\.t .*sort=dog/);

    const quoted = (await reader.propose('Add a heading called "so the manager can read it"; then draw a dog.')).candidates[0];
    assert.ok(quoted.check.ok, quoted.sop);
    assert.match(quoted.sop, /value="so the manager can read it"/);
    assert.doesNotMatch(quoted.sop, /act=load|w\.request\.unread/);
  } finally {
    await reader.close();
  }
});
