import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { damerauLevenshtein, buildSpellVocab, extractVocabFromKb } from '../src/spell/vocab.mjs';
import { createSpellChecker } from '../src/spell/z3-spell.mjs';
import { loadKnowledge } from '../src/kb/load-worlds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = resolve(process.env.SOP_KNOWLEDGE ?? join(HERE, '..', '..', 'sop-knowledge-worlds'));

test('damerauLevenshtein handles ins, del, sub, and adjacent transpositions', () => {
  assert.equal(damerauLevenshtein('table', 'table'), 0);
  assert.equal(damerauLevenshtein('atble', 'table'), 1);
  assert.equal(damerauLevenshtein('rtee', 'tree'), 1);
  assert.equal(damerauLevenshtein('selct', 'select'), 1);
  assert.equal(damerauLevenshtein('beeside', 'beside'), 1);
  assert.equal(damerauLevenshtein('ste', 'step'), 1);
  assert.equal(damerauLevenshtein('cat', 'cut'), 1);
  assert.equal(damerauLevenshtein('onte', 'onthe'), 1);
  assert.equal(damerauLevenshtein('seelkt', 'select'), 2);
});

test('buildSpellVocab indexes 10,000 words in < 100ms', () => {
  const words = [];
  for (let i = 0; i < 10000; i++) {
    words.push(`word${String(i).padStart(4, '0')}x`);
  }
  const t0 = performance.now();
  const vocab = buildSpellVocab({ words });
  const elapsed = performance.now() - t0;
  console.log(`buildSpellVocab(10k words) built in ${elapsed.toFixed(1)} ms`);
  assert.equal(vocab.stats.wordCount, 10000);
  assert.ok(elapsed < 100, `Expected < 100ms, got ${elapsed.toFixed(1)}ms`);
});

test('generic custom spreadsheet vocabulary (zero SOP Lang dependency) handles all 5 noise types + fast-path', async () => {
  const spreadsheetVocab = {
    words: [
      'select', 'delete', 'copy', 'paste', 'insert', 'sort', 'sum', 'step', 'one',
      'cell', 'cells', 'row', 'rows', 'column', 'columns', 'sheet', 'formula',
      'header', 'total', 'average', 'blue', 'green', 'bold', 'italic',
      'in', 'on', 'to', 'the', 'a', 'and', 'all', 'above', 'below',
    ],
    highFreqWords: ['in', 'on', 'to', 'the', 'a', 'and', 'all'],
    phrases: ['pivot table', 'header row', 'on the', 'in the', 'to the'],
  };

  const checker = await createSpellChecker({ vocab: spreadsheetVocab, timeoutMs: 2000 });

  // Fast-path: zero OOV, no Z3 call
  const clean = await checker.normalise('select all cells in the header row');
  assert.equal(clean.ok, true);
  assert.equal(clean.changed, false);
  assert.equal(clean.usedZ3, false);
  assert.equal(clean.cleanText, 'select all cells in the header row');
  assert.ok(clean.elapsedMs < 5, `Fast-path took ${clean.elapsedMs.toFixed(2)}ms`);

  // 1. Missing letter + 2. Extra/doubled letter
  const r1 = await checker.normalise('selct the bluue cell');
  assert.equal(r1.ok, true);
  assert.equal(r1.cleanText, 'select the blue cell');
  assert.equal(r1.usedZ3, true);

  // 3. Adjacent transposition + missing letter on short word (ste -> step)
  const r2 = await checker.normalise('delte the colmn in ste one');
  assert.equal(r2.ok, true);
  assert.equal(r2.cleanText, 'delete the column in step one');

  // 4. Merged words / missing space
  const r3 = await checker.normalise('paste the formula onthe sheet');
  assert.equal(r3.ok, true);
  assert.equal(r3.cleanText, 'paste the formula on the sheet');

  // 5. Shifted / stray spaces inside words
  const r4 = await checker.normalise('copy thec ell in form ula');
  assert.equal(r4.ok, true);
  assert.equal(r4.cleanText, 'copy the cell in formula');
});

let kb;
let kbVocab;
let kbChecker;

test('extractVocabFromKb builds KB vocab in < 200ms with inflections', async () => {
  kb = await loadKnowledge({ knowledgeDir: KNOWLEDGE });
  const t0 = performance.now();
  kbVocab = extractVocabFromKb(kb);
  const elapsed = performance.now() - t0;
  console.log(`extractVocabFromKb took ${elapsed.toFixed(1)} ms (${kbVocab.stats.wordCount} words, ${kbVocab.stats.phraseCount} phrases)`);
  assert.ok(elapsed < 200, `Expected < 200ms, got ${elapsed.toFixed(1)}ms`);
  assert.ok(kbVocab.hasWord('table'));
  assert.ok(kbVocab.hasWord('tables'));
  assert.ok(kbVocab.hasWord('bars'));
  assert.ok(kbVocab.hasWord('losing'));
  assert.ok(kbVocab.hasWord('stadiums'));
  assert.ok(kbVocab.hasWord('selecting'));
  assert.ok(kbVocab.hasWord('stand'));
  assert.ok(kbVocab.hasBigram('bar', 'chart'));

  kbChecker = await createSpellChecker({ vocab: kbVocab, timeoutMs: 2000 });
});

test('webmeet-dataset noisy cases & exact raw alignment', async () => {
  const cases = [
    {
      raw: 'copy the atble',
      expected: 'copy the table',
      check(res) {
        const tok = res.tokens.find((t) => t.text === 'table');
        assert.ok(tok, 'expected table token');
        assert.equal(tok.rawText, 'atble');
        assert.equal(res.rawText.slice(tok.rawStart, tok.rawEnd), 'atble');
      },
    },
    {
      raw: 'a small rtee',
      expected: 'a small tree',
    },
    {
      raw: 'selct the word "intro" in the Introduction heading',
      expected: 'select the word "intro" in the Introduction heading',
      check(res) {
        assert.ok(res.tokens.some((t) => t.text === '"intro"' && t.op === 'pass_through'));
        assert.ok(res.tokens.some((t) => t.text === 'Introduction' && t.op === 'pass_through'));
      },
    },
    {
      raw: '2024 beeside 2023',
      expected: '2024 beside 2023',
    },
    {
      raw: 'a drop shadow onte sail onthe boat',
      expected: 'a drop shadow on the sail on the boat',
    },
    {
      raw: 'the losing months should stando ut, so make theb ars below 7 teal',
      expected: 'the losing months should stand out, so make the bars below 7 teal',
      check(res) {
        assert.ok(res.cleanText.includes('stand out'));
        assert.ok(res.cleanText.includes('the bars'));
        const theTok = res.tokens.find((t) => t.text === 'the' && t.rawText === 'theb ars');
        const barsTok = res.tokens.find((t) => t.text === 'bars' && t.rawText === 'theb ars');
        assert.ok(theTok && barsTok, 'expected aligned tokens for "theb ars"');
        assert.equal(theTok.op, 'shift_space');
        assert.equal(barsTok.op, 'shift_space');
        assert.equal(res.rawText.slice(theTok.rawStart, theTok.rawEnd), 'theb ars');
      },
    },
    {
      raw: 'bar ch art',
      expected: 'bar chart',
    },
  ];

  for (const tc of cases) {
    const res = await kbChecker.normalise(tc.raw);
    console.log(`[bench] (${res.elapsedMs.toFixed(1)} ms, Z3=${res.usedZ3}) "${tc.raw}" -> "${res.cleanText}"`);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.cleanText, tc.expected);
    assert.equal(res.changed, true);
    if (tc.check) tc.check(res);
  }
});

test('Hard Entity Shield protects proper names, unknown domain nouns, coords, dates, times, codes, and clean fast-path', async () => {
  const proper = await kbChecker.normalise('place Sri above the starbucks block');
  console.log(`[bench] (${proper.elapsedMs.toFixed(1)} ms) proper-name shield: "${proper.cleanText}"`);
  assert.equal(proper.ok, true);
  assert.equal(proper.cleanText, 'place Sri above the starbucks block');
  assert.equal(proper.changed, false);

  const fast = await kbChecker.normalise('move n1 to 260,180 on 2026-12-07 at 15:00 UTC');
  console.log(`[bench] (${fast.elapsedMs.toFixed(2)} ms, Z3=${fast.usedZ3}) fast-path: "${fast.cleanText}"`);
  assert.equal(fast.ok, true);
  assert.equal(fast.changed, false);
  assert.equal(fast.usedZ3, false);
  assert.equal(fast.cleanText, 'move n1 to 260,180 on 2026-12-07 at 15:00 UTC');
  assert.ok(fast.elapsedMs < 5, `Expected fast-path < 5ms, got ${fast.elapsedMs.toFixed(2)}ms`);

  const validPairs = await kbChecker.normalise('make the bar on the boat blue');
  assert.equal(validPairs.ok, true);
  assert.equal(validPairs.changed, false);
  assert.equal(validPairs.usedZ3, false);
});

test('topK: 2 returns ranked alternatives and margin', async () => {
  const res = await kbChecker.normalise('copy the atble', { topK: 2 });
  assert.equal(res.ok, true);
  assert.equal(res.cleanText, 'copy the table');
  assert.equal(res.alternatives.length, 2);
  assert.equal(res.alternatives[0].cleanText, 'copy the table');
  assert.notEqual(res.alternatives[1].cleanText, res.alternatives[0].cleanText);
  assert.equal(typeof res.margin, 'number');
  assert.ok(res.margin >= 0, `Expected non-negative margin, got ${res.margin}`);
  console.log(`topK=2 margin=${res.margin}, alt2="${res.alternatives[1].cleanText}" (cost=${res.alternatives[1].totalEditCost})`);
});

test('createSpellChecker({ kb, tab }) works directly and handles inthe/tothe/makeit/delte/empty', async () => {
  const diagChecker = await createSpellChecker({ kb, tab: 'diagram', timeoutMs: 2000 });

  const empty = await diagChecker.normalise('');
  assert.equal(empty.ok, true);
  assert.equal(empty.changed, false);
  assert.equal(empty.usedZ3, false);

  const r1 = await diagChecker.normalise('delte the nodes inthe diagram and makeit blue');
  assert.equal(r1.ok, true);
  assert.equal(r1.cleanText, 'delete the nodes in the diagram and make it blue');

  const r2 = await diagChecker.normalise('connect n1 tothe box');
  assert.equal(r2.ok, true);
  assert.equal(r2.cleanText, 'connect n1 to the box');
});
