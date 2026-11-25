import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVerifier } from '../src/verify/check.mjs';
import { compareCircuits, compareProposals } from '../eval/compare.mjs';
import { csvRows, webmeetCsvRows } from '../eval/benchmark.mjs';

import { createZ3SemanticEvaluator } from '../eval/z3-equiv.mjs';
import { loadKnowledge } from '../src/kb/load-worlds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBMEET_DIR = resolve(HERE, '..', '..', 'webmeet-dataset');

const verifier = await createVerifier();

test('createVerifier accepts a grounded drawing circuit', () => {
  const text = 'make the house blue';
  const sop = [
    '@r1 w.request.request act=change mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');

  const res = verifier.check(text, sop);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.errors.length, 0);
  assert.equal(res.warnings.length, 0);
  assert.deepEqual(res.uncoveredWords, []);
});

test('native properties use each request target as owner in a mixed circuit', () => {
  const text = 'make the house blue and book Ops review';
  const sop = [
    '@r1 w.request.request act=change mood=do words="make the house blue" predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue',
    '@r2 w.request.request act=make mood=do words="book Ops review" predicate=book',
    '@r2.t w.request.target request=$r2 family=meeting mode=new',
    '@r2.c1 w.request.constraint request=$r2 on=attribute attribute=meeting.title value="Ops review"',
  ].join('\n');
  const result = verifier.check(text, sop);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const swapped = sop.replace('attribute=meeting.title', 'attribute=drawn.label');
  assert.ok(verifier.check(text, swapped).errors.some((error) =>
    error.key === 'attribute' && error.why.includes('request target family meeting')));
  const unknown = sop.replace('attribute=meeting.title', 'attribute=meeting.unknown');
  assert.ok(verifier.check(text, unknown).errors.some((error) => error.why === 'not a declared request property'));
});

test('the property catalog retains separate meanings and enforces closed values', () => {
  const groupNames = verifier.KEYS.get('group.name');
  assert.ok(groupNames.some((key) => key.means === 'w.drawing.group.label' && key.head === 'span'));
  assert.ok(groupNames.some((key) => key.means === 'w.diagram.group.label' && key.head === 'candidate'));
  const sop = [
    '@r1 w.request.request act=make mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=chart mode=new',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=imaginary open_value=false',
  ].join('\n');
  assert.ok(verifier.check('make an imaginary chart', sop).errors.some((error) => error.key === 'value'));
});

test('createVerifier validates real clean rows from webmeet-dataset when present', () => {
  const sampleFile = join(WEBMEET_DIR, 'diagram', 'diagrams-05.csv');
  if (!existsSync(sampleFile)) return;
  const rows = csvRows(readFileSync(sampleFile, 'utf8'));
  rows.next(); // header
  let checked = 0;
  for (const [text, sop] of rows) {
    const res = verifier.check(text, sop, 'diagram');
    assert.equal(res.ok, true, `Expected valid webmeet row "${text}": ${JSON.stringify(res.errors)}`);
    checked++;
    if (checked >= 15) break;
  }
  assert.equal(checked, 15);
});

test('createVerifier rejects invalid acts, moods, keys, lookups, phrases, and bad fillers', () => {
  // 1. Parse error
  const parseRes = verifier.check('draw a house', '@r1 w.request.request act="unterminated', 'drawing');
  assert.equal(parseRes.ok, false);
  assert.equal(parseRes.wires, null);

  // 2. Bad act and bad mood (k.actions closed + enum)
  const badActRes = verifier.check(
    'blorp a house',
    '@r1 w.request.request act=blorp mood=maybe\n@r1.t w.request.target request=$r1 family=drawn mode=new sort=house',
    'drawing',
  );
  assert.equal(badActRes.ok, false);
  const badActKeys = new Set(badActRes.errors.map((e) => e.key));
  assert.ok(badActKeys.has('act'));
  assert.ok(badActKeys.has('mood'));

  // 3. Property from an incompatible family (chart.type on a drawn target)
  const badKeyRes = verifier.check(
    'make a bar chart',
    [
      '@r1 w.request.request act=make mood=do predicate=make',
      '@r1.t w.request.target request=$r1 family=drawn mode=new sort=chart',
      '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar operator=eq phase=result',
    ].join('\n'),
    'drawing',
  );
  assert.equal(badKeyRes.ok, false);
  assert.ok(badKeyRes.errors.some((e) => e.key === 'attribute' && e.why.includes('target family drawn')));

  // 4. Missing lookup on unidentified existing target
  const missingLookupRes = verifier.check(
    'make it blue',
    [
      '@r1 w.request.request act=change mood=do predicate=make',
      '@r1.t w.request.target request=$r1 family=drawn mode=existing',
      '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
    ].join('\n'),
    'drawing',
  );
  assert.equal(missingLookupRes.ok, false);
  assert.ok(missingLookupRes.errors.some((e) => e.why.includes('lookup')));

  // 5. Unquoted/quoted phrase not in text
  const badPhraseRes = verifier.check(
    'draw a house',
    [
      '@r1 w.request.request act=make mood=do predicate=draw',
      '@r1.t w.request.target request=$r1 family=drawn mode=new sort=house',
      '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=red words="bright red" operator=eq phase=result',
    ].join('\n'),
    'drawing',
  );
  assert.equal(badPhraseRes.ok, false);
  assert.ok(badPhraseRes.errors.some((e) => e.key === 'words' && e.why === 'phrase not found in the text'));

  // 6. Filler hiding content words inside request words
  const badFillerRes = verifier.check(
    'please make the house blue',
    [
      '@f1 w.request.filler text="please make"',
      '@r1 w.request.request act=change mood=do predicate=make',
      '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
      '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
    ].join('\n'),
    'drawing',
  );
  assert.equal(badFillerRes.ok, false);
  assert.ok(badFillerRes.errors.some((e) => e.why === 'filler hides content words of a request'));
});

test('createVerifier emits warnings for uncovered words, missing proper names, and act-predicate contradiction', () => {
  // Uncovered word + missing proper name ("Alice")
  const res1 = verifier.check(
    'draw a giant house for Alice',
    [
      '@r1 w.request.request act=make mood=do predicate=draw',
      '@r1.t w.request.target request=$r1 family=drawn mode=new determiner=indefinite sort=house',
    ].join('\n'),
    'drawing',
  );
  assert.equal(res1.ok, true);
  assert.ok(res1.uncoveredWords.includes('giant'));
  assert.ok(res1.uncoveredWords.includes('Alice'));
  assert.ok(res1.warnings.some((w) => w.why === 'words no wire formalizes'));
  assert.ok(res1.warnings.some((w) => w.why === 'proper name of the text missing from the circuit'));

  // Act contradicts removal predicate ("delete")
  const res2 = verifier.check(
    'delete the house',
    [
      '@r1 w.request.request act=make mood=do predicate=delete',
      '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    ].join('\n'),
    'drawing',
  );
  assert.equal(res2.ok, true);
  assert.ok(res2.warnings.some((w) => w.why.startsWith('act contradicts the predicate')));
});

test('compareCircuits handles exact_match and alias equivalence', () => {
  const text = 'bar graph, grey, horizontal .6, show values, no gridlines';
  const goldSop = [
    '@r1 w.request.request act=make mood=do',
    '@r1.t w.request.target request=$r1 family=chart mode=new',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar words="bar graph" operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=drawn.color value=grey operator=eq phase=result',
    '@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.horizontal value=on words=horizontal operator=eq phase=result',
    '@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.barWidth value=".6" operator=eq phase=result',
    '@r1.c5 w.request.constraint request=$r1 on=attribute attribute=chart.showValues value=on words="show values" operator=eq phase=result',
    '@r1.c6 w.request.constraint request=$r1 on=attribute attribute=chart.gridlines value=off words="no gridlines" operator=eq phase=result',
  ].join('\n');

  // Note: drawn.color is not a diagram key, so use chart.colour/chart.color or drawing colour in a drawing test;
  // here let's test chart aliases in diagram and colour/grey in drawing!
  const predSop = [
    '@r1 w.request.request act=make mood=do',
    '@r1.t w.request.target request=$r1 family=chart mode=new',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar words="bar graph" operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.colour value=gray words=grey operator=eq phase=result',
    '@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.orientation value=horizontal operator=eq phase=result',
    '@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.barWidth value="0.6" words=".6" operator=eq phase=result',
    '@r1.c5 w.request.constraint request=$r1 on=attribute attribute=chart.show_values value=show words="show values" operator=eq phase=result',
    '@r1.c6 w.request.constraint request=$r1 on=attribute attribute=chart.grid value=hide words="no gridlines" operator=eq phase=result',
  ].join('\n');

  // Make goldSop valid on diagram too using chart.colour
  const validGoldSop = goldSop.replace('attribute=drawn.color', 'attribute=chart.colour');
  const cmp = compareCircuits({ text, tab: 'diagram', goldSop: validGoldSop, predSop, verifier });
  assert.equal(cmp.predValid, true);
  assert.equal(cmp.goldValid, true);
  assert.equal(cmp.constraintAliasF1.f1, 1);
  assert.ok(cmp.constraintStrictF1.f1 < 1);
  assert.equal(cmp.semanticExact, true);
  assert.equal(cmp.fairCategory, 'exact_match');

  // Also test drawn.color <-> drawn.colour + grey <-> gray in drawing tab
  const drawText = 'paint the house grey';
  const drawGold = [
    '@r1 w.request.request act=change mood=do predicate=paint',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.color value=grey operator=eq phase=result',
  ].join('\n');
  const drawPred = [
    '@r1 w.request.request act=change mood=do predicate=paint',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=gray words=grey operator=eq phase=result',
  ].join('\n');
  const drawCmp = compareCircuits({ text: drawText, tab: 'drawing', goldSop: drawGold, predSop: drawPred, verifier });
  assert.equal(drawCmp.semanticExact, true);
  assert.equal(drawCmp.fairCategory, 'exact_match');
});

test('compareCircuits classifies pred_better_than_gold on real bad-filler example', () => {
  const text = 'bar graph, orange horizontal .6; name Power; x on top; invert y';
  const goldSop = [
    '@f1 w.request.filler text=x',
    '@f2 w.request.filler text="top; invert y"',
    '@r1 w.request.request act=make mood=do words="bar graph, orange horizontal .6; name Power"',
    '@r1.t w.request.target request=$r1 family=chart mode=new determiner=indefinite',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar words="bar graph" operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.colour value=orange operator=eq phase=result',
    '@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.horizontal value=on words=horizontal operator=eq phase=result',
    '@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.title value=Power operator=eq phase=result key_words=name',
    '@r1.c5 w.request.constraint on=attribute request=$r1 attribute=chart.barWidth value="0.6" words=".6" operator=eq phase=result',
  ].join('\n');

  const predSop = [
    '@r1 w.request.request act=make mood=do',
    '@r1.t w.request.target request=$r1 family=chart mode=new',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar words="bar graph" operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.colour value=orange operator=eq phase=result',
    '@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.orientation value=horizontal operator=eq phase=result',
    '@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.barWidth value="0.6" words=".6" operator=eq phase=result',
    '@r1.c5 w.request.constraint request=$r1 on=attribute attribute=chart.title value=Power operator=eq phase=result key_words=name',
    '@r1.c6 w.request.constraint request=$r1 on=attribute attribute=chart.xAxis value=top key_words=x operator=eq phase=result',
    '@r1.c7 w.request.constraint request=$r1 on=attribute attribute=chart.invert value=y key_words=invert operator=eq phase=result',
  ].join('\n');

  const cmp = compareCircuits({ text, tab: 'diagram', goldSop, predSop, verifier });
  assert.equal(cmp.predValid, true);
  assert.equal(cmp.predZeroWarn, true);
  assert.equal(cmp.goldAnnotationFlawed, true);
  assert.ok(cmp.goldIssueReasons.includes('gold_bad_filler'));
  assert.equal(cmp.fairCategory, 'pred_better_than_gold');
});

test('compareCircuits classifies pred_better_than_gold on hull-overlap example and pred_wrong on errors', () => {
  const text = 'can you move the house to 260,180 and then make the house blue?';
  const goldSop = [
    '@f1 w.request.filler text="can you"',
    '@r1 w.request.request act=place mood=do words="move the house to 260,180" predicate=move words_origin=hull',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.x value=260 operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=drawn.y value=180 operator=eq phase=result',
    '@r2 w.request.request act=change mood=do words="the house to 260,180 and then make the house blue" predicate=make words_origin=hull',
    '@r2.t w.request.target request=$r2 family=drawn mode=existing determiner=definite name="the house"',
    '@r2.c1 w.request.constraint request=$r2 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');

  const predSop = [
    '@f1 w.request.filler text="can you"',
    '@r1 w.request.request act=place mood=do words="move the house to 260,180" predicate=move',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.x value=260 operator=eq phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=drawn.y value=180 operator=eq phase=result',
    '@r2 w.request.request act=change mood=do words="make the house blue" predicate=make',
    '@r2.t w.request.target request=$r2 family=drawn mode=existing determiner=definite sort=house',
    '@r2.c1 w.request.constraint request=$r2 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');

  const hullCmp = compareCircuits({ text, tab: 'drawing', goldSop, predSop, verifier });
  assert.equal(hullCmp.predValid, true);
  assert.equal(hullCmp.goldAnnotationFlawed, true);
  assert.ok(hullCmp.goldIssueReasons.includes('gold_hull_overlap'));
  assert.equal(hullCmp.fairCategory, 'pred_better_than_gold');

  // pred_wrong: wrong act + wrong constraint against clean gold
  const cleanText = 'make the house blue';
  const cleanGold = [
    '@r1 w.request.request act=change mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');
  const wrongPred = [
    '@r1 w.request.request act=remove mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=red words=blue operator=eq phase=result',
  ].join('\n');
  const wrongCmp = compareCircuits({ text: cleanText, tab: 'drawing', goldSop: cleanGold, predSop: wrongPred, verifier });
  assert.equal(wrongCmp.fairCategory, 'pred_wrong');

  // pred_partial: clean gold, valid pred, act matches, one of two constraints missing
  const partialText = 'make the house big and blue';
  const partialGold = [
    '@r1 w.request.request act=change mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=size attribute=drawn.size value=big operator=degree phase=result',
    '@r1.c2 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');
  const partialPred = [
    '@r1 w.request.request act=change mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');
  const partialCmp = compareCircuits({ text: partialText, tab: 'drawing', goldSop: partialGold, predSop: partialPred, verifier });
  assert.equal(partialCmp.predValid, true);
  assert.equal(partialCmp.fairCategory, 'pred_partial');
  assert.equal(partialCmp.attribution, 'fail_z3_constraints_or_target');
});

test('compareCircuits root-cause attribution separates redundant Gold id, input typos, and Z3 errors', () => {
  // 1. equiv_gold_redundant_id: Gold echoes target.name in calendar.id
  const calText = 'bin the Choir calendar';
  const calGold = [
    '@r1 w.request.request act=remove mood=do predicate=bin',
    '@r1.t w.request.target request=$r1 family=calendar mode=existing determiner=definite fill=written name=Choir family_words=calendar',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=calendar.id value=Choir operator=eq phase=selector',
  ].join('\n');
  const calPred = [
    '@r1 w.request.request act=remove mood=do predicate=bin',
    '@r1.t w.request.target request=$r1 family=calendar mode=existing determiner=definite fill=written name=Choir family_words=calendar',
  ].join('\n');
  const calCmp = compareCircuits({ text: calText, tab: 'calendar', goldSop: calGold, predSop: calPred, verifier });
  assert.equal(calCmp.equivRedundantId, true);
  assert.equal(calCmp.attribution, 'equiv_gold_redundant_id');

  // 2. fail_input_typo: clean Gold normalizing "atble" -> sort=table, pred leaves "atble" unread
  const typoText = 'copy the atble';
  const typoGold = [
    '@r1 w.request.request act=copy mood=do predicate=copy',
    '@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=description sort=table sort_words=atble',
  ].join('\n');
  const typoPred = [
    '@r1 w.request.request act=copy mood=do predicate=copy',
    '@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context',
    '@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page',
    '@r1.u1 w.request.unread request=$r1 text=atble',
  ].join('\n');
  const typoCmp = compareCircuits({ text: typoText, tab: 'diagram', goldSop: typoGold, predSop: typoPred, verifier, knownVocab: new Set(['copy', 'table']) });
  assert.equal(typoCmp.inputHasTypo, true);
  assert.equal(typoCmp.attribution, 'fail_input_typo');
});

test('WebMeet CSV retains one text with independently scoped numbered references', () => {
  const csv = 'text,sop,sop1,sop2\r\n"write, then read","@1 foo\n@2 bar",,"@1 baz"\r\nlegacy,@1 foo';
  const [first, second, ...extra] = webmeetCsvRows(csv, 'records.csv');
  assert.deepEqual(extra, []);
  assert.equal(first.source, 'records.csv:2');
  assert.equal(first.text, 'write, then read');
  assert.deepEqual(first.goldReferences, [
    { column: 'sop', sop: '@1 foo\n@2 bar' },
    { column: 'sop2', sop: '@1 baz' },
  ]);
  assert.deepEqual(second.goldReferences, [{ column: 'sop', sop: '@1 foo' }]);
  assert.throws(() => [...webmeetCsvRows('text,sop,context\ncommand,circuit,area', 'bad.csv')], /bad.csv/);
  assert.throws(() => [...webmeetCsvRows('text,sop\ncommand,circuit,extra', 'bad.csv')], /bad.csv:2/);
});

test('mechanical and Z3 proposal grades accept a numbered reference and report an invalid sibling', async () => {
  const text = 'make the house blue';
  const sop = [
    '@r1 w.request.request act=change mood=do predicate=make',
    '@r1.t w.request.target request=$r1 family=drawn mode=existing determiner=definite sort=house',
    '@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.colour value=blue operator=eq phase=result',
  ].join('\n');
  const invalid = sop.replace('drawn.colour', 'meeting.title');
  const incomplete = sop.split('\n').slice(0, 2).join('\n');
  const references = [
    { column: 'sop', sop: incomplete },
    { column: 'sop1', sop },
    { column: 'sop3', sop: invalid },
  ];
  const evaluator = await createZ3SemanticEvaluator({ kb: await loadKnowledge({ includeLegacy: false }), verifier });
  try {
    for (const compare of [compareProposals, evaluator.evaluateProposalsZ3]) {
      const options = { text, proposals: [sop], verifier };
      for (const goldReferences of [references, [...references].reverse()]) {
        const result = await compare({ ...options, goldReferences });
        assert.equal(result.legendGrade, 'L3');
        assert.equal(result.bestReferenceColumn, 'sop1');
        assert.equal(result.goldValid, true);
        assert.equal(result.goldAnnotationFlawed, true);
        assert.ok(result.referenceIssues.find(({ column }) => column === 'sop3')?.errors.length);
      }
      const bad = await compare({ ...options, goldReferences: [references[2]] });
      assert.equal(bad.legendGrade, 'L0');
      assert.equal(bad.bestReferenceColumn, null);
      assert.equal(bad.attribution, 'fail_gold_annotation_flawed');
      assert.equal(bad.semanticExact, false);
      const empty = await compare({ ...options, goldReferences: [] });
      assert.equal(empty.legendGrade, 'L0');
      assert.deepEqual(empty.goldIssueReasons, ['gold_missing_reference']);
    }
  } finally {
    evaluator.runner.close();
  }
});
