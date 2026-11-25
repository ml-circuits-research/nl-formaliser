import test from 'node:test';
import assert from 'node:assert/strict';
import { HYP_KINDS } from '../src/contracts.mjs';
import { encodeProblem } from '../src/smt/encode.mjs';
import { createZ3Runner } from '../src/smt/z3-runner.mjs';
import { modelToSop } from '../src/emit/to-sop.mjs';

function makeMockKb() {
  const keys = [
    { id: 0, tab: 'drawing', family: 'drawn', name: 'drawn.colour', shortName: 'colour', head: 'candidate+step', values: null, valuesRaw: [], onDefault: 'attribute' },
    { id: 1, tab: 'drawing', family: 'drawn', name: 'drawn.x', shortName: 'x', head: 'number', values: null, valuesRaw: [], onDefault: 'attribute' },
    { id: 2, tab: 'drawing', family: 'drawn', name: 'drawn.y', shortName: 'y', head: 'number', values: null, valuesRaw: [], onDefault: 'attribute' },
    { id: 3, tab: 'drawing', family: 'drawn', name: 'drawn.size', shortName: 'size', head: 'number+class+step', values: null, valuesRaw: [], onDefault: 'size' },
    { id: 4, tab: 'drawing', family: 'part', name: 'part.colour', shortName: 'colour', head: 'candidate', values: null, valuesRaw: [], onDefault: 'attribute' },
    { id: 5, tab: 'drawing', family: 'part', name: 'part.size', shortName: 'size', head: 'class', values: new Set(['tiny', 'small', 'default', 'big', 'huge']), valuesRaw: ['tiny', 'small', 'default', 'big', 'huge'], onDefault: 'size' },
    { id: 6, tab: 'drawing', family: 'drawn', name: 'drawn.preset', shortName: 'preset', head: 'class', values: new Set(['robot', 'alien', 'clown']), valuesRaw: ['robot', 'alien', 'clown'], onDefault: 'attribute' },
  ];
  const keyMap = new Map(keys.map((k) => [k.name, k]));
  const attrToId = new Map(keys.map((k) => [k.name, k.id]));
  return {
    tabs: {
      drawing: {
        families: ['drawn', 'part', 'page'],
        familySet: new Set(['drawn', 'part', 'page']),
        keys: keyMap,
        keyList: keys,
        attrToId,
      },
    },
  };
}

const runner = await createZ3Runner({ timeoutMs: 4000 });
const kb = makeMockKb();

test('Z3 keeps the available proposal when the requested alternatives are exhausted', async () => {
  const unique = '(declare-const choice Bool)\n(assert choice)';
  const result = await runner.solve(unique, ['choice'], { topK: 2, blockVars: ['choice'] });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.status, 'sat');
  assert.deepEqual(result.solutions.map((model) => model.get('choice')), [true]);

  const unavailable = await runner.solve(`${unique}\n(assert (not choice))`, ['choice']);
  assert.equal(unavailable.status, 'unsat', unavailable.error);
  const malformed = await runner.solve('(assert undeclared_choice)', []);
  assert.equal(malformed.status, 'error');
  assert.match(malformed.error, /undeclared_choice/);
  const next = await runner.solve('(declare-const choice Bool)\n(assert (not choice))', ['choice']);
  assert.equal(next.ok, true, next.error);
  assert.equal(next.solutions[0].get('choice'), false);
});

test('Z3 disambiguates "make a blue house" (act=make, mode=new) vs "make the house blue" (act=change, mode=existing)', async () => {
  // 1. "make a blue house"
  const text1 = 'make a blue house';
  const tokens1 = [
    { index: 0, text: 'make', lower: 'make', start: 0, end: 4, isContent: true, isGrammar: false, isFiller: false },
    { index: 1, text: 'a', lower: 'a', start: 5, end: 6, isContent: false, isGrammar: true, isFiller: false },
    { index: 2, text: 'blue', lower: 'blue', start: 7, end: 11, isContent: true, isGrammar: false, isFiller: false },
    { index: 3, text: 'house', lower: 'house', start: 12, end: 17, isContent: true, isGrammar: false, isFiller: false },
  ];
  const cands1 = [
    { id: 0, kind: HYP_KINDS.PREDICATE, startTok: 0, endTok: 0, text: 'make', cost: 4, licensed: [{ act: 'make' }, { act: 'change' }] },
    { id: 1, kind: HYP_KINDS.CONSTRAINT, startTok: 2, endTok: 2, text: 'blue', cost: 6, attribute: 'drawn.colour', attrFamily: 'drawn', value: 'blue', operator: 'eq', on: 'attribute' },
    { id: 2, kind: HYP_KINDS.CONSTRAINT, startTok: 2, endTok: 2, text: 'blue', cost: 6, attribute: 'part.colour', attrFamily: 'part', value: 'blue', operator: 'eq', on: 'attribute' },
    { id: 3, kind: HYP_KINDS.TARGET_SORT, startTok: 3, endTok: 3, text: 'house', cost: 5, families: ['drawn'], sort: 'house', det: 'indefinite' },
    { id: 4, kind: HYP_KINDS.UNREAD, startTok: 0, endTok: 0, text: 'make', cost: 120 },
    { id: 5, kind: HYP_KINDS.UNREAD, startTok: 2, endTok: 2, text: 'blue', cost: 120 },
    { id: 6, kind: HYP_KINDS.UNREAD, startTok: 3, endTok: 3, text: 'house', cost: 120 },
  ];
  const lat1 = { text: text1, tab: 'drawing', tokens: tokens1, candidates: cands1, hasQuestionMark: false };
  const enc1 = encodeProblem(lat1, { kb });
  const res1 = await runner.solve(enc1.smtBody, enc1.queryVars);
  assert.equal(res1.ok, true, res1.error);
  const sop1 = modelToSop(res1.solutions[0], lat1, enc1.meta);
  assert.match(sop1, /act=make mood=do predicate=make/);
  assert.match(sop1, /family=drawn mode=new determiner=indefinite sort=house/);
  assert.match(sop1, /attribute=drawn\.colour value=blue operator=eq phase=result/);
  assert.doesNotMatch(sop1, /w\.request\.lookup/);

  // 2. "make the house blue"
  const text2 = 'make the house blue';
  const tokens2 = [
    { index: 0, text: 'make', lower: 'make', start: 0, end: 4, isContent: true, isGrammar: false, isFiller: false },
    { index: 1, text: 'the', lower: 'the', start: 5, end: 8, isContent: false, isGrammar: true, isFiller: false },
    { index: 2, text: 'house', lower: 'house', start: 9, end: 14, isContent: true, isGrammar: false, isFiller: false },
    { index: 3, text: 'blue', lower: 'blue', start: 15, end: 19, isContent: true, isGrammar: false, isFiller: false },
  ];
  const cands2 = [
    { id: 0, kind: HYP_KINDS.PREDICATE, startTok: 0, endTok: 0, text: 'make', cost: 4, licensed: [{ act: 'make' }, { act: 'change' }] },
    { id: 1, kind: HYP_KINDS.TARGET_SORT, startTok: 2, endTok: 2, text: 'house', cost: 5, families: ['drawn'], sort: 'house', det: 'definite' },
    { id: 2, kind: HYP_KINDS.CONSTRAINT, startTok: 3, endTok: 3, text: 'blue', cost: 6, attribute: 'drawn.colour', attrFamily: 'drawn', value: 'blue', operator: 'eq', on: 'attribute' },
    { id: 3, kind: HYP_KINDS.CONSTRAINT, startTok: 3, endTok: 3, text: 'blue', cost: 6, attribute: 'part.colour', attrFamily: 'part', value: 'blue', operator: 'eq', on: 'attribute' },
    { id: 4, kind: HYP_KINDS.UNREAD, startTok: 0, endTok: 0, text: 'make', cost: 120 },
    { id: 5, kind: HYP_KINDS.UNREAD, startTok: 2, endTok: 2, text: 'house', cost: 120 },
    { id: 6, kind: HYP_KINDS.UNREAD, startTok: 3, endTok: 3, text: 'blue', cost: 120 },
  ];
  const lat2 = { text: text2, tab: 'drawing', tokens: tokens2, candidates: cands2, hasQuestionMark: false };
  const enc2 = encodeProblem(lat2, { kb });
  const res2 = await runner.solve(enc2.smtBody, enc2.queryVars);
  assert.equal(res2.ok, true, res2.error);
  const sop2 = modelToSop(res2.solutions[0], lat2, enc2.meta);
  assert.match(sop2, /act=change mood=do predicate=make/);
  assert.match(sop2, /family=drawn mode=existing determiner=definite fill=description sort=house/);
  assert.match(sop2, /attribute=drawn\.colour value=blue operator=eq phase=result/);
});

test('Z3 enforces Lookup Necessity Law & KEY_WORD binding on "please switch to the robot preset"', async () => {
  const text = 'please switch to the robot preset';
  const tokens = [
    { index: 0, text: 'please', lower: 'please', start: 0, end: 6, isContent: true, isGrammar: false, isFiller: true },
    { index: 1, text: 'switch', lower: 'switch', start: 7, end: 13, isContent: true, isGrammar: false, isFiller: false },
    { index: 2, text: 'to', lower: 'to', start: 14, end: 16, isContent: false, isGrammar: true, isFiller: false },
    { index: 3, text: 'the', lower: 'the', start: 17, end: 20, isContent: false, isGrammar: true, isFiller: false },
    { index: 4, text: 'robot', lower: 'robot', start: 21, end: 26, isContent: true, isGrammar: false, isFiller: false },
    { index: 5, text: 'preset', lower: 'preset', start: 27, end: 33, isContent: true, isGrammar: false, isFiller: false },
  ];
  const cands = [
    { id: 0, kind: HYP_KINDS.FILLER, startTok: 0, endTok: 0, text: 'please', cost: 3 },
    { id: 1, kind: HYP_KINDS.PREDICATE, startTok: 1, endTok: 1, text: 'switch', cost: 4, licensed: [{ act: 'change' }] },
    { id: 2, kind: HYP_KINDS.CONSTRAINT, startTok: 4, endTok: 4, text: 'robot', cost: 6, attribute: 'drawn.preset', attrFamily: 'drawn', value: 'robot', operator: 'eq', on: 'attribute' },
    { id: 3, kind: HYP_KINDS.KEY_WORD, startTok: 5, endTok: 5, text: 'preset', cost: 3, attrs: ['drawn.preset'] },
    { id: 4, kind: HYP_KINDS.UNREAD, startTok: 0, endTok: 0, text: 'please', cost: 120 },
    { id: 5, kind: HYP_KINDS.UNREAD, startTok: 1, endTok: 1, text: 'switch', cost: 120 },
    { id: 6, kind: HYP_KINDS.UNREAD, startTok: 4, endTok: 4, text: 'robot', cost: 120 },
    { id: 7, kind: HYP_KINDS.UNREAD, startTok: 5, endTok: 5, text: 'preset', cost: 120 },
  ];
  const lat = { text, tab: 'drawing', tokens, candidates: cands, hasQuestionMark: false };
  const enc = encodeProblem(lat, { kb });
  const res = await runner.solve(enc.smtBody, enc.queryVars, { topK: 2, blockVars: enc.blockVars });
  assert.equal(res.ok, true, res.error);
  const sop = modelToSop(res.solutions[0], lat, enc.meta);
  assert.match(sop, /@f1 w\.request\.filler text=please/);
  assert.match(sop, /@r1 w\.request\.request act=change mood=do predicate=switch/);
  assert.match(sop, /@r1\.l1 w\.request\.lookup request=\$r1 target=\$r1\.t key=thing from=page/);
  assert.match(sop, /attribute=drawn\.preset value=robot operator=eq phase=result key_words=preset/);
});

test('Z3 splits multi-request cleanly with exact tight words spans', async () => {
  const text = 'move the house to 260,180, then make the house blue';
  const tokens = [
    { index: 0, text: 'move', lower: 'move', start: 0, end: 4, isContent: true, isGrammar: false, isFiller: false },
    { index: 1, text: 'the', lower: 'the', start: 5, end: 8, isContent: false, isGrammar: true, isFiller: false },
    { index: 2, text: 'house', lower: 'house', start: 9, end: 14, isContent: true, isGrammar: false, isFiller: false },
    { index: 3, text: 'to', lower: 'to', start: 15, end: 17, isContent: false, isGrammar: true, isFiller: false },
    { index: 4, text: '260,180', lower: '260,180', start: 18, end: 25, isContent: true, isGrammar: false, isFiller: false },
    { index: 5, text: ',', lower: ',', start: 25, end: 26, isContent: false, isGrammar: false, isFiller: false },
    { index: 6, text: 'then', lower: 'then', start: 27, end: 31, isContent: false, isGrammar: true, isFiller: false },
    { index: 7, text: 'make', lower: 'make', start: 32, end: 36, isContent: true, isGrammar: false, isFiller: false },
    { index: 8, text: 'the', lower: 'the', start: 37, end: 40, isContent: false, isGrammar: true, isFiller: false },
    { index: 9, text: 'house', lower: 'house', start: 41, end: 46, isContent: true, isGrammar: false, isFiller: false },
    { index: 10, text: 'blue', lower: 'blue', start: 47, end: 51, isContent: true, isGrammar: false, isFiller: false },
  ];
  const cands = [
    { id: 0, kind: HYP_KINDS.PREDICATE, startTok: 0, endTok: 0, text: 'move', cost: 4, licensed: [{ act: 'place' }] },
    { id: 1, kind: HYP_KINDS.TARGET_SORT, startTok: 2, endTok: 2, text: 'house', cost: 5, families: ['drawn'], sort: 'house', det: 'definite' },
    {
      id: 2, kind: HYP_KINDS.CONSTRAINT, startTok: 4, endTok: 4, text: '260,180', cost: 6,
      attribute: 'drawn.x', attrFamily: 'drawn', value: '260', operator: 'eq', on: 'attribute',
      pairedConstraints: [
        { attribute: 'drawn.x', value: '260', operator: 'eq', on: 'attribute' },
        { attribute: 'drawn.y', value: '180', operator: 'eq', on: 'attribute' },
      ],
    },
    { id: 3, kind: HYP_KINDS.SEP, startTok: 5, endTok: 6, text: ', then', cost: 0, canSplitClause: true, isStrongSplit: true },
    { id: 4, kind: HYP_KINDS.PREDICATE, startTok: 7, endTok: 7, text: 'make', cost: 4, licensed: [{ act: 'make' }, { act: 'change' }] },
    { id: 5, kind: HYP_KINDS.TARGET_SORT, startTok: 9, endTok: 9, text: 'house', cost: 5, families: ['drawn'], sort: 'house', det: 'definite' },
    { id: 6, kind: HYP_KINDS.CONSTRAINT, startTok: 10, endTok: 10, text: 'blue', cost: 6, attribute: 'drawn.colour', attrFamily: 'drawn', value: 'blue', operator: 'eq', on: 'attribute' },
    // Unread fallbacks
    ...[0, 2, 4, 7, 9, 10].map((t, i) => ({ id: 7 + i, kind: HYP_KINDS.UNREAD, startTok: t, endTok: t, text: tokens[t].text, cost: 120 })),
  ];
  const lat = { text, tab: 'drawing', tokens, candidates: cands, hasQuestionMark: false };
  const enc = encodeProblem(lat, { kb });
  const res = await runner.solve(enc.smtBody, enc.queryVars);
  assert.equal(res.ok, true, res.error);
  const sop = modelToSop(res.solutions[0], lat, enc.meta);
  assert.match(sop, /@r1 w\.request\.request act=place mood=do words="move the house to 260,180" predicate=move/);
  assert.match(sop, /@r1\.c1 w\.request\.constraint request=\$r1 on=attribute attribute=drawn\.x value="260"/);
  assert.match(sop, /@r1\.c2 w\.request\.constraint request=\$r1 on=attribute attribute=drawn\.y value="180"/);
  assert.match(sop, /@r2 w\.request\.request act=change mood=do words="make the house blue" predicate=make/);
  assert.match(sop, /@r2\.c1 w\.request\.constraint request=\$r2 on=attribute attribute=drawn\.colour value=blue/);
});
