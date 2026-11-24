import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HYP_KINDS } from '../src/contracts.mjs';
import { lemmatiseWord, singularisePhrase } from '../src/lattice/morph.mjs';
import { tokenize } from '../src/lattice/tokenize.mjs';
import { buildLattice } from '../src/lattice/candidates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function makeMockKb() {
  const grammarWords = new Set([
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
    'it', 'them', 'one', 'i', 'you', 'we',
    'in', 'on', 'at', 'to', 'from', 'by', 'of', 'for', 'with', 'about', 'above', 'below', 'under', 'near', 'behind', 'before', 'after', 'into', 'onto',
    'and', 'or', 'but', 'then', 'also', 'next',
    'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'may',
    'not', 'no', 'never', 'without', 'just', 'very', 'as', 'much', 'more', 'most', 'please', 'there', 'than',
  ]);
  const fillerWords = new Set(['please', 'um', 'uh', 'ok', 'okay', 'thanks', 'hmm', 'well', 'just', 'actually', 'hey', 'want', 'need', 'like']);

  return {
    grammar: {
      words: grammarWords,
      fillerWords,
      fillerPhrases: new Set(['can you', 'could you', 'could you please', 'thank you', "i'd like", 'i want', "let's", 'would you']),
      irregularPlurals: new Map([
        ['children', 'child'],
        ['people', 'person'],
        ['leaves', 'leaf'],
        ['mice', 'mouse'],
      ]),
      irregularVerbs: new Map([
        ['went', 'go'],
        ['drew', 'draw'],
        ['drawn', 'draw'],
        ['kept', 'keep'],
        ['left', 'leave'],
        ['made', 'make'],
        ['took', 'take'],
      ]),
      numbers: new Map([['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5]]),
    },
    isGrammarWord(w) {
      const lower = String(w).toLowerCase().replace(/\u2019/g, "'");
      return grammarWords.has(lower) || lower === "let's" || lower === "don't";
    },
    isFillerWord(w) {
      return fillerWords.has(String(w).toLowerCase().replace(/\u2019/g, "'"));
    },
    verbs: new Map([
      ['make', [{ act: 'make', mode: 'none' }, { act: 'change', mode: 'none' }]],
      ['draw', [{ act: 'make', mode: 'none' }]],
      ['add', [{ act: 'make', mode: 'none' }]],
      ['create', [{ act: 'make', mode: 'none' }]],
      ['move', [{ act: 'place', mode: 'none' }]],
      ['put', [{ act: 'place', mode: 'none' }, { act: 'make', mode: 'none' }]],
      ['change', [{ act: 'change', mode: 'none' }]],
      ['turn', [{ act: 'change', mode: 'none', attribute: 'orientation' }]],
      ['turn off', [{ act: 'change', mode: 'none', attribute: 'visible', value: 'off' }]],
      ['take', [{ act: 'pick', mode: 'none' }]],
      ['take off', [{ act: 'remove', mode: 'none' }]],
      ['take apart', [{ act: 'take apart', mode: 'ungroup' }]],
      ['get rid of', [{ act: 'remove', mode: 'none' }]],
      ['delete', [{ act: 'remove', mode: 'none' }]],
      ['remove', [{ act: 'remove', mode: 'none' }]],
      ['keep', [{ act: 'remove', mode: 'none' }]],
      ['group', [{ act: 'group', mode: 'none' }]],
      ['connect', [{ act: 'connect', mode: 'none' }]],
      ['schedule', [{ act: 'make', mode: 'none' }]],
      ['cancel', [{ act: 'remove', mode: 'none' }]],
      ['enlarge', [{ act: 'change', mode: 'none', attribute: 'size', value: 'larger' }]],
      ['shrink', [{ act: 'change', mode: 'none', attribute: 'size', value: 'smaller' }]],
      ['darken', [{ act: 'change', mode: 'none', attribute: 'colour', value: 'darker' }]],
      ['resize', [{ act: 'change', mode: 'none', attribute: 'size' }]],
      ['list', [{ act: 'ask', mode: 'none' }]],
      ['count', [{ act: 'ask', mode: 'none' }]],
      ['bold', [{ act: 'change', mode: 'none' }]],
    ]),
    domain: {
      objects: new Set(['house', 'tree', 'apple tree', 'cloud', 'sun', 'cat', 'orange', 'glasses', 'table', 'box']),
      shapes: new Set(['circle', 'rectangle', 'diamond', 'box', 'oval', 'triangle', 'square']),
      bodyParts: new Set(['nose', 'hair', 'eye', 'hat']),
      genres: new Set(['letter', 'email', 'report', 'story', 'note']),
      diagrams: new Set(['flowchart', 'mind map', 'org chart', 'tree']),
      charts: new Set(['bar', 'line', 'pie', 'scatter', 'doughnut']),
      colours: new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white', 'gray', 'grey']),
      scales: new Set(['tiny', 'small', 'default', 'big', 'huge']),
      comparatives: new Set(['bigger', 'larger', 'smaller', 'tinier', 'wider', 'shorter', 'taller', 'thinner', 'thicker', 'darker', 'lighter', 'later']),
      scenes: new Set(['harbour', 'forest', 'beach']),
      feelings: new Set(['happy', 'sad', 'surprised', 'smiling']),
      styles: new Set(['sepia', 'sketch', 'comic', 'dashed']),
      wearables: new Set(['hat', 'glasses', 'sunglasses', 't-shirt', 'cat-eye']),
      layouts: new Set(['grid', 'row', 'column', 'circle', 'tree']),
    },
    tabs: {
      drawing: {
        families: ['drawn', 'part', 'page', 'group', 'composition'],
        keys: new Map([
          ['drawn.colour', { family: 'drawn', head: 'candidate+step' }],
          ['drawn.color', { family: 'drawn', head: 'candidate' }],
          ['drawn.outline', { family: 'drawn', head: 'candidate' }],
          ['drawn.size', { family: 'drawn', head: 'number+class+step', values: ['tiny', 'small', 'default', 'big', 'huge'] }],
          ['drawn.width', { family: 'drawn', head: 'number' }],
          ['drawn.height', { family: 'drawn', head: 'number' }],
          ['drawn.x', { family: 'drawn', head: 'number' }],
          ['drawn.y', { family: 'drawn', head: 'number' }],
          ['drawn.at', { family: 'drawn', head: 'class', values: ['top_left', 'top_right', 'left', 'right', 'top', 'bottom', 'center', 'corner'] }],
          ['drawn.direction', { family: 'drawn', head: 'class', values: ['up', 'down', 'left', 'right'] }],
          ['drawn.edge', { family: 'drawn', head: 'class', values: ['left', 'right', 'top', 'bottom'] }],
          ['drawn.relation', { family: 'drawn', head: 'class', values: ['in', 'on', 'under', 'above', 'below', 'next_to', 'left_of', 'right_of', 'near', 'behind'] }],
          ['drawn.anchor', { family: 'drawn', head: 'fill+span' }],
          ['drawn.id', { family: 'drawn', head: 'candidate' }],
          ['drawn.ids', { family: 'drawn', head: 'candidate' }],
          ['drawn.count', { family: 'drawn', head: 'number' }],
          ['drawn.expression', { family: 'drawn', head: 'class', values: ['happy', 'sad', 'surprised', 'smiling'] }],
          ['drawn.wear', { family: 'drawn', head: 'candidate' }],
          ['drawn.name', { family: 'drawn', head: 'span' }],
          ['drawn.label', { family: 'drawn', head: 'candidate' }],
          ['part.colour', { family: 'part', head: 'candidate' }],
          ['part.size', { family: 'part', head: 'class', values: ['tiny', 'small', 'default', 'big', 'huge'] }],
          ['part.owner', { family: 'part', head: 'span' }],
          ['part.ids', { family: 'part', head: 'span' }],
          ['part.variant', { family: 'part', head: 'class', values: ['sunglasses', 'cat-eye', 't-shirt'] }],
          ['page.scene', { family: 'page', head: 'span' }],
          ['page.style', { family: 'page', head: 'span' }],
          ['page.filter', { family: 'page', head: 'candidate', values: ['sepia', 'night', 'none'] }],
          ['group.members', { family: 'group', head: 'span' }],
        ]),
        familyWords: new Map([
          ['part', 'part'],
          ['group', 'group'],
          ['page', 'page'],
          ['drawing', 'drawn'],
          ['object', 'drawn'],
        ]),
        keyWordIndex: new Map([
          ['colour', [{ attr: 'drawn.colour', family: 'drawn' }, { attr: 'part.colour', family: 'part' }]],
          ['color', [{ attr: 'drawn.color', family: 'drawn' }]],
          ['size', [{ attr: 'drawn.size', family: 'drawn' }, { attr: 'part.size', family: 'part' }]],
          ['width', [{ attr: 'drawn.width', family: 'drawn' }]],
          ['height', [{ attr: 'drawn.height', family: 'drawn' }]],
          ['name', [{ attr: 'drawn.name', family: 'drawn' }]],
          ['label', [{ attr: 'drawn.label', family: 'drawn' }]],
          ['scene', [{ attr: 'page.scene', family: 'page' }]],
        ]),
        closedValueIndex: new Map([
          ['top_left', [{ attr: 'drawn.at', value: 'top_left', family: 'drawn' }]],
          ['top left', [{ attr: 'drawn.at', value: 'top_left', family: 'drawn' }]],
          ['left', [
            { attr: 'drawn.direction', value: 'left', family: 'drawn' },
            { attr: 'drawn.at', value: 'left', family: 'drawn' },
            { attr: 'drawn.edge', value: 'left', family: 'drawn' },
          ]],
          ['above', [{ attr: 'drawn.relation', value: 'above', family: 'drawn' }]],
          ['sepia', [{ attr: 'page.filter', value: 'sepia', family: 'page' }]],
        ]),
      },
      diagram: {
        families: ['chart', 'node', 'link', 'diagram', 'group'],
        keys: new Map([
          ['chart.type', { family: 'chart', head: 'candidate', values: ['bar', 'line', 'pie', 'doughnut', 'scatter'] }],
          ['chart.measure', { family: 'chart', head: 'span' }],
          ['chart.dimension', { family: 'chart', head: 'span' }],
          ['chart.colour', { family: 'chart', head: 'candidate' }],
          ['chart.title', { family: 'chart', head: 'span' }],
          ['chart.legend', { family: 'chart', head: 'class', values: ['show', 'hide', 'top', 'bottom', 'left', 'right'] }],
          ['chart.gridlines', { family: 'chart', head: 'class', values: ['on', 'off'] }],
          ['chart.xAxis', { family: 'chart', head: 'class', values: ['bottom', 'top'] }],
          ['chart.xLabel', { family: 'chart', head: 'span' }],
          ['chart.values', { family: 'chart', head: 'span' }],
          ['chart.id', { family: 'chart', head: 'candidate' }],
          ['node.shape', { family: 'node', head: 'class+step', values: ['box', 'circle', 'diamond', 'rectangle'] }],
          ['node.colour', { family: 'node', head: 'candidate+step' }],
          ['node.label', { family: 'node', head: 'span' }],
          ['node.id', { family: 'node', head: 'candidate' }],
          ['node.ids', { family: 'node', head: 'candidate' }],
          ['node.x', { family: 'node', head: 'number' }],
          ['node.y', { family: 'node', head: 'number' }],
          ['node.position', { family: 'node', head: 'class', values: ['above', 'below', 'near', 'next_to'] }],
          ['node.anchor', { family: 'node', head: 'fill+span' }],
          ['link.from', { family: 'link', head: 'fill+span' }],
          ['link.to', { family: 'link', head: 'fill+span' }],
          ['link.colour', { family: 'link', head: 'candidate' }],
          ['diagram.kind', { family: 'diagram', head: 'candidate', values: ['flowchart', 'mind_map', 'org_chart', 'tree'] }],
          ['diagram.layout', { family: 'diagram', head: 'class', values: ['tree', 'grid', 'row', 'column'] }],
          ['diagram.about', { family: 'diagram', head: 'span' }],
        ]),
        familyWords: new Map([
          ['chart', 'chart'],
          ['graph', 'chart'],
          ['node', 'node'],
          ['link', 'link'],
          ['diagram', 'diagram'],
          ['group', 'group'],
        ]),
        keyWordIndex: new Map([
          ['x axis', [{ attr: 'chart.xAxis', family: 'chart' }, { attr: 'chart.xLabel', family: 'chart' }]],
          ['legend', [{ attr: 'chart.legend', family: 'chart' }]],
          ['gridlines', [{ attr: 'chart.gridlines', family: 'chart' }]],
          ['title', [{ attr: 'chart.title', family: 'chart' }]],
          ['label', [{ attr: 'node.label', family: 'node' }]],
          ['colour', [{ attr: 'node.colour', family: 'node' }, { attr: 'chart.colour', family: 'chart' }]],
        ]),
        closedValueIndex: new Map([
          ['bar', [{ attr: 'chart.type', value: 'bar', family: 'chart' }]],
          ['on', [{ attr: 'chart.gridlines', value: 'on', family: 'chart' }]],
          ['off', [{ attr: 'chart.gridlines', value: 'off', family: 'chart' }]],
          ['top', [{ attr: 'chart.xAxis', value: 'top', family: 'chart' }, { attr: 'chart.legend', value: 'top', family: 'chart' }]],
        ]),
      },
      document: {
        families: ['section', 'block', 'text', 'document', 'inline'],
        keys: new Map([
          ['text.title', { family: 'text', head: 'span' }],
          ['text.about', { family: 'text', head: 'span' }],
          ['text.genre', { family: 'text', head: 'candidate', values: ['letter', 'email', 'report', 'story', 'note'] }],
          ['text.words', { family: 'text', head: 'number' }],
          ['text.length', { family: 'text', head: 'class+step', values: ['short', 'medium', 'long'] }],
          ['document.topic', { family: 'document', head: 'candidate' }],
          ['section.order', { family: 'section', head: 'class', values: ['before', 'after', 'first', 'last'] }],
          ['section.order_anchor', { family: 'section', head: 'fill+span' }],
          ['section.role', { family: 'section', head: 'candidate', values: ['introduction', 'conclusion', 'summary', 'paragraph'] }],
          ['section.content', { family: 'section', head: 'span' }],
          ['section.id', { family: 'section', head: 'candidate' }],
          ['section.mark', { family: 'section', head: 'candidate', values: ['bold', 'italic', 'underline', 'highlight'] }],
          ['block.kind', { family: 'block', head: 'candidate', values: ['paragraph', 'heading', 'quote'] }],
          ['block.level', { family: 'block', head: 'number' }],
          ['block.id', { family: 'block', head: 'candidate' }],
          ['inline.format', { family: 'inline', head: 'class', values: ['bold', 'italic', 'underline', 'highlight'] }],
          ['inline.link_target', { family: 'inline', head: 'span' }],
        ]),
        familyWords: new Map([
          ['section', 'section'],
          ['paragraph', ['section', 'block']],
          ['block', 'block'],
          ['document', 'document'],
          ['text', 'text'],
        ]),
        keyWordIndex: new Map([
          ['title', [{ attr: 'text.title', family: 'text' }]],
          ['words', [{ attr: 'text.words', family: 'text' }]],
          ['level', [{ attr: 'block.level', family: 'block' }]],
          ['topic', [{ attr: 'document.topic', family: 'document' }]],
        ]),
        closedValueIndex: new Map([
          ['bold', [{ attr: 'inline.format', value: 'bold', family: 'inline' }, { attr: 'section.mark', value: 'bold', family: 'section' }]],
          ['italic', [{ attr: 'inline.format', value: 'italic', family: 'inline' }]],
          ['paragraph', [{ attr: 'block.kind', value: 'paragraph', family: 'block' }, { attr: 'section.role', value: 'paragraph', family: 'section' }]],
          ['heading', [{ attr: 'block.kind', value: 'heading', family: 'block' }]],
          ['conclusion', [{ attr: 'section.role', value: 'conclusion', family: 'section' }]],
        ]),
      },
      calendar: {
        families: ['meeting', 'calendar', 'room', 'person'],
        keys: new Map([
          ['meeting.day', { family: 'meeting', head: 'candidate+span' }],
          ['meeting.time', { family: 'meeting', head: 'candidate+span+step' }],
          ['meeting.end', { family: 'meeting', head: 'span' }],
          ['meeting.timezone', { family: 'meeting', head: 'candidate' }],
          ['meeting.length', { family: 'meeting', head: 'number+class+step' }],
          ['meeting.duration', { family: 'meeting', head: 'number' }],
          ['meeting.title', { family: 'meeting', head: 'span' }],
          ['meeting.calendar', { family: 'meeting', head: 'span' }],
          ['meeting.room', { family: 'meeting', head: 'fill+span' }],
          ['meeting.people', { family: 'meeting', head: 'fill+span' }],
          ['meeting.relation', { family: 'meeting', head: 'class', values: ['before', 'after', 'during', 'between'] }],
          ['meeting.relation_anchor', { family: 'meeting', head: 'fill+span' }],
          ['meeting.id', { family: 'meeting', head: 'candidate' }],
          ['calendar.name', { family: 'calendar', head: 'span' }],
          ['calendar.colour', { family: 'calendar', head: 'candidate' }],
          ['room.name', { family: 'room', head: 'span' }],
          ['room.capacity', { family: 'room', head: 'number' }],
        ]),
        familyWords: new Map([
          ['meeting', 'meeting'],
          ['calendar', 'calendar'],
          ['room', 'room'],
          ['person', 'person'],
        ]),
        keyWordIndex: new Map([
          ['title', [{ attr: 'meeting.title', family: 'meeting' }]],
          ['room', [{ attr: 'meeting.room', family: 'meeting' }, { attr: 'room.name', family: 'room' }]],
          ['calendar', [{ attr: 'meeting.calendar', family: 'meeting' }]],
          ['timezone', [{ attr: 'meeting.timezone', family: 'meeting' }]],
        ]),
        closedValueIndex: new Map([
          ['before', [{ attr: 'meeting.relation', value: 'before', family: 'meeting' }]],
          ['after', [{ attr: 'meeting.relation', value: 'after', family: 'meeting' }]],
        ]),
      },
    },
  };
}

test('morph: lemmatiseWord covers irregulars, suffixes, doubled consonants, and keeps original', () => {
  const kb = makeMockKb();

  assert.equal(lemmatiseWord('Children', kb)[0], 'children');
  assert.ok(lemmatiseWord('Children', kb).includes('child'));
  assert.ok(lemmatiseWord('leaves', kb).includes('leaf'));
  assert.ok(lemmatiseWord('went', kb).includes('go'));
  assert.ok(lemmatiseWord('stories', kb).includes('story'));
  assert.ok(lemmatiseWord('copied', kb).includes('copy'));
  assert.ok(lemmatiseWord('boxes', kb).includes('box'));
  assert.ok(lemmatiseWord('circles', kb).includes('circle'));
  assert.ok(lemmatiseWord('flipped', kb).includes('flip'));
  assert.ok(lemmatiseWord('moved', kb).includes('move'));
  assert.ok(lemmatiseWord('sitting', kb).includes('sit'));
  assert.ok(lemmatiseWord('resizing', kb).includes('resize'));
  assert.ok(lemmatiseWord('tinier', kb).includes('tiny'));
  assert.ok(lemmatiseWord('bigger', kb).includes('big'));
  assert.ok(lemmatiseWord('biggest', kb).includes('big'));
  assert.ok(lemmatiseWord('largest', kb).includes('large'));

  // Singularise multi-word phrases
  assert.ok(singularisePhrase('apple trees', kb).includes('apple tree'));
  assert.ok(singularisePhrase('bar charts', kb).includes('bar chart'));
  assert.ok(singularisePhrase('blue boxes', kb).includes('blue box'));
});

test('tokenize: preserves exact offsets and classifies special tokens properly', () => {
  const kb = makeMockKb();
  const text =
    'Move "My Box" and o1, b2 to 260,180 (-5, 0.6, .6, 45%) on 2026-11-18 at 14:30 Europe/Bucharest; meet May with brown-haired t-shirt 3d don\'t!';

  const toks = tokenize(text, kb);
  for (let i = 0; i < toks.length; i++) {
    assert.equal(toks[i].index, i);
    assert.equal(text.slice(toks[i].start, toks[i].end), toks[i].text);
  }

  const byText = (t) => toks.find((x) => x.text === t);
  assert.equal(byText('"My Box"').kind, 'quote');
  assert.equal(byText('"My Box"').inner, 'My Box');
  assert.equal(byText('o1').kind, 'code');
  assert.equal(byText('b2').kind, 'code');
  assert.equal(byText('260,180').kind, 'coord');
  assert.equal(byText('260,180').coordX, '260');
  assert.equal(byText('260,180').coordY, '180');
  assert.equal(byText('-5').kind, 'number');
  assert.equal(byText('0.6').kind, 'number');
  assert.equal(byText('.6').kind, 'number');
  assert.equal(byText('45%').kind, 'number');
  assert.equal(byText('2026-11-18').kind, 'date');
  assert.equal(byText('14:30').kind, 'time');
  assert.equal(byText('Europe/Bucharest').kind, 'word');
  assert.equal(byText('Europe/Bucharest').isTimezone, true);
  assert.equal(byText('Europe/Bucharest').isContent, true);
  assert.equal(byText('brown-haired').kind, 'word');
  assert.equal(byText('t-shirt').kind, 'word');
  assert.equal(byText('3d').kind, 'word');
  assert.equal(byText("don't").kind, 'word');

  // Proper name mid-sentence (May is also in grammarWords!) must have isProperCandidate=true & isContent=true
  const mayTok = byText('May');
  assert.equal(mayTok.isCapitalized, true);
  assert.equal(mayTok.isSentenceStart, false);
  assert.equal(mayTok.isProperCandidate, true);
  assert.equal(mayTok.isContent, true);

  // Sentence-start Move is not isProperCandidate
  const moveTok = byText('Move');
  assert.equal(moveTok.isSentenceStart, true);
  assert.equal(moveTok.isProperCandidate, false);
});

test('lattice (drawing): enumerates unfiltered ambiguous hypotheses, coords, separable phrasal verbs, comparatives, keeping verbs', () => {
  const kb = makeMockKb();

  // 1. Ambiguity preserved: "orange" as both sort and colour; "make" licenses both make and change
  const l1 = buildLattice('please make an orange circle and move it to 260,180', { tab: 'drawing', kb });
  const c1 = l1.candidates;
  assert.ok(c1.every((c) => l1.text.slice(c.start, c.end) === c.text));

  const pleaseFiller = c1.find((c) => c.kind === HYP_KINDS.FILLER && c.text === 'please');
  assert.ok(pleaseFiller);

  const makePred = c1.find((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'make');
  assert.ok(makePred);
  const acts = makePred.licensed.map((l) => l.act);
  assert.ok(acts.includes('make') && acts.includes('change'));

  const orangeSort = c1.find((c) => c.kind === HYP_KINDS.TARGET_SORT && c.sort === 'orange');
  const orangeCol = c1.find((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'drawn.colour' && c.value === 'orange');
  assert.ok(orangeSort && orangeCol, 'orange must propose both TARGET_SORT and CONSTRAINT(colour)');

  const coordPair = c1.find((c) => c.kind === HYP_KINDS.CONSTRAINT && c.pairedConstraints?.length === 2);
  assert.ok(coordPair);
  assert.deepEqual(coordPair.pairedConstraints.map((p) => [p.attribute, p.value]), [
    ['drawn.x', '260'],
    ['drawn.y', '180'],
  ]);

  assert.ok(l1.splitPoints.some((sp) => sp.text === 'and'));

  // 2. Separable phrasal verb + part/wearable + spaced coord
  const l2 = buildLattice('take the sunglasses off and move nose to 100, 200', { tab: 'drawing', kb });
  const takePred = l2.candidates.find((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'take');
  assert.ok(takePred);
  assert.ok(takePred.licensed.some((l) => l.act === 'remove' && l.particle === 'off'));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.TARGET_SORT && c.family === 'part' && c.sort === 'nose'));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.text === '100, 200' && c.pairedConstraints?.length === 2));

  // 3. Keeping verb + count + relation + anchor + dark blue + comparative
  const l3 = buildLattice('keep two of the trees above the house and make the cloud a lot bigger', { tab: 'drawing', kb });
  const keepPred = l3.candidates.find((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'keep');
  assert.ok(keepPred && keepPred.isKeepingVerb);
  assert.ok(keepPred.licensed.some((l) => l.act === 'remove' && l.keeping));
  assert.ok(l3.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'drawn.relation' && c.value === 'above'));
  assert.ok(l3.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'drawn.anchor' && c.value === 'house' && c.isAnchor));
  assert.ok(l3.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'drawn.size' && c.operator === 'delta' && c.step === 'much_more' && c.text === 'a lot bigger'));

  // 4. Question + UNREAD phrase cheaper than singletons
  const l4 = buildLattice('what colour is the flibber jabber?', { tab: 'drawing', kb });
  assert.equal(l4.hasQuestionMark, true);
  assert.ok(l4.candidates.some((c) => c.kind === HYP_KINDS.PREDICATE && c.licensed.some((l) => l.act === 'ask' && l.question === 'what')));
  assert.ok(l4.candidates.some((c) => c.kind === HYP_KINDS.KEY_WORD && c.attrs.includes('drawn.colour')));
  const unreadPhrase = l4.candidates.find((c) => c.kind === HYP_KINDS.UNREAD && c.text === 'flibber jabber');
  const unreadSingle1 = l4.candidates.find((c) => c.kind === HYP_KINDS.UNREAD && c.text === 'flibber');
  const unreadSingle2 = l4.candidates.find((c) => c.kind === HYP_KINDS.UNREAD && c.text === 'jabber');
  assert.ok(unreadPhrase && unreadSingle1 && unreadSingle2);
  assert.ok(unreadPhrase.cost < unreadSingle1.cost + unreadSingle2.cost);
});

test('lattice (diagram): charts, measures, dimensions, codes, links, separable phrasal verbs', () => {
  const kb = makeMockKb();

  const l1 = buildLattice('make a bar chart of the stadiums by country', { tab: 'diagram', kb });
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'chart.type' && c.value === 'bar' && c.text === 'bar chart'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'chart.measure' && c.value === 'stadiums'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'chart.dimension' && c.value === 'country'));

  const l2 = buildLattice('connect n1 to n2 and turn the gridlines off', { tab: 'diagram', kb });
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.TARGET_REF && c.isCode && c.ids.includes('n1')));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'node.id' && c.value === 'n1' && c.phase === 'selector'));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'link.to' && c.value === 'n2'));
  const turnPred = l2.candidates.find((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'turn');
  assert.ok(turnPred.licensed.some((l) => l.particle === 'off'));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.KEY_WORD && c.attrs.includes('chart.gridlines')));
});

test('lattice (document): genres, ordinals, section order, marks, word counts, questions', () => {
  const kb = makeMockKb();

  const l1 = buildLattice('write a short report about penguins of 200 words and move the first paragraph before the conclusion', { tab: 'document', kb });
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.TARGET_SORT && c.sort === 'report'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'text.words' && c.measure === 200 && c.unit === 'word'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.TARGET_FAMILY && c.ordinal === 'first' && c.familyWords === 'paragraph'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'section.order' && c.value === 'before'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'section.order_anchor' && c.value === 'conclusion' && c.isAnchor));

  const l2 = buildLattice('how many words are in the document?', { tab: 'document', kb });
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'how many' && c.licensed.some((l) => l.question === 'count')));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.KEY_WORD && c.attrs.includes('text.words')));
  assert.ok(l2.candidates.some((c) => c.kind === HYP_KINDS.TARGET_FAMILY && c.family === 'document'));
});

test('lattice (calendar): dates, times, timezones, duration, proper names, name intro', () => {
  const kb = makeMockKb();

  const l1 = buildLattice('Could you please schedule Review on Work 4 on 2026-11-18 at 14:30 Europe/Bucharest for 30 minutes', { tab: 'calendar', kb });
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.FILLER && c.text === 'Could you please'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.PREDICATE && c.text === 'schedule'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.TARGET_REF && c.isProper && c.name === 'Review'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.TARGET_REF && c.isProper && c.name === 'Work 4'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'meeting.day' && c.value === '2026-11-18'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'meeting.time' && c.value === '14:30'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'meeting.timezone' && c.value === 'Europe/Bucharest'));
  assert.ok(l1.candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.attribute === 'meeting.length' && c.measure === 30 && c.unit === 'minute'));
});

test('lattice (real kb integration via loadKnowledge)', async (t) => {
  const kbLoaderPath = join(ROOT, 'src', 'kb', 'load-worlds.mjs');
  if (!existsSync(kbLoaderPath)) {
    t.skip('src/kb/load-worlds.mjs not present yet');
    return;
  }
  const mod = await import(kbLoaderPath);
  const loadKb = mod.loadKnowledge ?? mod.loadWorlds ?? mod.default;
  if (typeof loadKb !== 'function') {
    t.skip('No known loader export in load-worlds.mjs');
    return;
  }
  const kb = await loadKb();

  const cases = [
    ['drawing', 'Can you move the red house above the big tree and make it blue?'],
    ['diagram', 'make a bar chart of the stadiums by country'],
    ['document', 'how many words are in the document?'],
    ['calendar', 'Please schedule Review on 2026-12-14 at 14:00 UTC for 30 minutes'],
  ];

  for (const [tab, text] of cases) {
    const l = buildLattice(text, { tab, kb });
    assert.ok(l.tokens.length >= 4, `tokens for ${tab}`);
    assert.ok(l.candidates.length >= 10 && l.candidates.length <= 400, `candidate count ${l.candidates.length} for ${tab}`);
    assert.ok(l.candidates.every((c) => l.text.slice(c.start, c.end) === c.text), `exact offsets for ${tab}`);
    // Every content token must have at least one covering candidate (including UNREAD)
    for (const tok of l.tokens) {
      if (tok.isContent) {
        assert.ok(
          l.candidates.some((c) => c.startTok <= tok.index && tok.index <= c.endTok),
          `content token "${tok.text}" uncovered in ${tab}`
        );
      }
    }
  }
});
