import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadKnowledge } from '../src/kb/load-worlds.mjs';
import { TABS, unquoteSop } from '../src/contracts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = resolve(process.env.SOP_KNOWLEDGE ?? join(HERE, '..', '..', 'sop-knowledge-worlds'));

let kb;
let loadMs = 0;

test('loadKnowledge loads in under 3 seconds', async () => {
  const t0 = performance.now();
  kb = await loadKnowledge({ knowledgeDir: KNOWLEDGE });
  loadMs = performance.now() - t0;
  console.log(`loadKnowledge took ${loadMs.toFixed(1)} ms`);
  assert.ok(loadMs < 3000, `Expected load time < 3000ms, got ${loadMs.toFixed(1)}ms`);
  assert.equal(kb.knowledgeDir, KNOWLEDGE);
  assert.ok(kb.sopworldPath.endsWith('sopworld.mjs'));
});

test('all 4 tabs loaded with >= 430 keys total and proper indices', () => {
  let totalKeys = 0;
  for (const tabName of TABS) {
    const tab = kb.tabs[tabName];
    assert.ok(tab, `Missing tab ${tabName}`);
    assert.ok(tab.families.length > 0, `${tabName} has families`);
    assert.equal(tab.families.length, tab.familySet.size);
    assert.equal(tab.keys.size, tab.keyList.length);
    assert.equal(tab.attrToId.size, tab.keyList.length);
    totalKeys += tab.keys.size;

    for (let i = 0; i < tab.keyList.length; i++) {
      const spec = tab.keyList[i];
      assert.equal(spec.id, i);
      assert.equal(tab.attrToId.get(spec.name), i);
      assert.equal(tab.keys.get(spec.name), spec);
    }
  }
  assert.ok(totalKeys >= 430, `Expected >= 430 keys, got ${totalKeys}`);

  // Spot check keyWords and closedValueIndex
  const drawnColour = kb.tabs.drawing.keys.get('drawn.colour');
  assert.ok(drawnColour.keyWords.has('colour'));
  assert.ok(drawnColour.keyWords.has('color'));
  assert.ok(kb.tabs.drawing.keyWordIndex.get('color')?.has('drawn.colour'));

  const xLabel = kb.tabs.diagram.keys.get('chart.xLabel');
  assert.ok(xLabel.keyWords.has('x label'));
  assert.ok(xLabel.keyWords.has('x axis label'));

  const topLeftHits = kb.tabs.drawing.closedValueIndex.get('top left') ?? [];
  assert.ok(topLeftHits.some((h) => h.attr === 'drawn.at' && h.value === 'top_left' && h.exact === false));
  const topLeftExact = kb.tabs.drawing.closedValueIndex.get('top_left') ?? [];
  assert.ok(topLeftExact.some((h) => h.attr === 'drawn.at' && h.value === 'top_left' && h.exact === true));

  // Spot check familyWords
  assert.ok(kb.tabs.drawing.familyWords.get('avatar')?.has('drawn'));
  assert.ok(kb.tabs.diagram.familyWords.get('graph')?.has('chart'));
  assert.ok(kb.tabs.diagram.familyWords.get('arrow')?.has('link'));
  assert.ok(kb.tabs.calendar.familyWords.get('event')?.has('meeting'));
  assert.ok(kb.tabs.document.familyWords.get('heading')?.has('section'));
});

test('k.actions acts, verbs, finer-act modes, and markings loaded', () => {
  for (const act of ['make', 'change', 'place', 'remove', 'ask', 'connect', 'group', 'take apart', 'pick', 'copy', 'undo', 'redo', 'save', 'load', 'send', 'deselect']) {
    assert.ok(kb.acts.has(act), `Missing act ${act}`);
  }
  assert.ok(kb.verbs.size >= 300, `Expected >= 300 verbs, got ${kb.verbs.size}`);
  assert.ok(kb.verbs.get('delete')?.some((v) => v.act === 'remove'));
  assert.ok(kb.verbs.get('arrange')?.some((v) => v.act === 'place' && v.mode === 'arrange'));
  assert.ok(kb.verbs.get('merge')?.some((v) => v.act === 'group' && v.mode === 'merge'));
  assert.ok(kb.verbs.get('ungroup')?.some((v) => v.act === 'take apart' && v.mode === 'ungroup'));
  assert.ok(kb.verbs.get('split')?.some((v) => v.act === 'take apart' && v.mode === 'split'));
  assert.ok(kb.verbs.get('disconnect')?.some((v) => v.act === 'take apart' && v.mode === 'disconnect'));
  assert.ok(kb.verbs.get('reverse')?.some((v) => v.act === 'change' && v.mode === 'reverse'));
  assert.ok(kb.verbs.get('repeat')?.some((v) => v.act === 'copy' && v.mode === 'repeat'));

  const setEntries = kb.verbs.get('set') ?? [];
  assert.ok(setEntries.some((v) => v.act === 'change' && !v.mode));
  assert.ok(setEntries.some((v) => v.act === 'change' && v.mode === 'set'));

  assert.ok(kb.markings.size > 0);
  assert.ok(kb.markings.get('compare')?.some((m) => m.marker === 'with'));
});

test('grammarWords, fillerWords, contractionEndings match w.lang.en (check.mjs) exactly', async () => {
  const { parse } = await import(pathToFileURL(kb.sopworldPath).href);
  const expectedGrammar = new Set();
  const expectedFiller = new Set();
  const expectedEndings = new Set();
  const expectedContractions = [];

  const dir = join(KNOWLEDGE, 'docs', 'worlds', 'w.lang.en', 'shards');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sop'))) {
    for (const w of parse(readFileSync(join(dir, f), 'utf8'))) {
      const cls = w.attrs.class ? unquoteSop(w.attrs.class[0]) : '';
      const texts = (w.attrs.text ?? []).map((t) => unquoteSop(t).toLowerCase());
      if (w.type === 'w.lang.en.closed' && ['determiner', 'pronoun', 'preposition', 'conjunction', 'auxiliary', 'particle', 'adverb'].includes(cls)) {
        texts.forEach((t) => expectedGrammar.add(t));
      }
      if (w.type === 'w.lang.en.closed' && cls === 'interjection') {
        texts.forEach((t) => expectedFiller.add(t));
      }
      if (w.type === 'w.lang.en.skip') {
        texts.forEach((t) => (['politeness', 'filler', 'desire'].includes(cls) ? expectedFiller : expectedGrammar).add(t));
      }
      if (w.type === 'w.lang.en.imperative.lead') {
        texts.forEach((t) => expectedGrammar.add(t));
      }
      if (w.type === 'w.lang.en.contraction') {
        expectedContractions.push([texts[0], unquoteSop(w.attrs.expands[0]).toLowerCase()]);
      }
      if (w.type === 'w.lang.en.contraction.ending') {
        expectedEndings.add(unquoteSop(w.attrs.ending[0]).toLowerCase());
      }
    }
  }
  for (const [t, e] of expectedContractions) {
    if (e.split(/\s+/).every((x) => expectedGrammar.has(x))) expectedGrammar.add(t);
  }

  assert.deepEqual([...kb.grammar.grammarWords].sort(), [...expectedGrammar].sort());
  assert.deepEqual([...kb.grammar.fillerWords].sort(), [...expectedFiller].sort());
  assert.deepEqual([...kb.grammar.contractionEndings].sort(), [...expectedEndings].sort());

  assert.equal(kb.isGrammarWord('the'), true);
  assert.equal(kb.isGrammarWord("don\u2019t"), true);
  assert.equal(kb.isGrammarWord('house'), false);
  assert.equal(kb.isFillerWord('please'), true);
  assert.equal(kb.isFillerWord('thank you'), true);
  assert.equal(kb.isFillerWord('circle'), false);

  assert.ok(kb.grammar.determiners.get('the')?.det === 'definite');
  assert.ok(kb.grammar.pronouns.has('it'));
  assert.ok(kb.grammar.prepositions.has('above'));
  assert.ok(kb.grammar.joiners.has('and'));
  assert.ok(kb.grammar.whWords.has('what'));
  assert.ok(kb.grammar.auxiliaries.has('is'));
  assert.equal(kb.grammar.negations.get('not all')?.want, 'not_all');
  assert.ok(kb.grammar.cues.length >= 100);
  assert.equal(kb.grammar.numbers.get('five')?.value, 5);
  assert.equal(kb.grammar.ordinals.get('second_last') ?? kb.grammar.ordinals.get('second last'), 'second_last');
  assert.equal(kb.grammar.quantifiers.get('all')?.fill, 'all');
  assert.ok(kb.grammar.irregularPlurals.get('children') === 'child' || kb.grammar.irregularPlurals.get('cacti') === 'cactus');
  assert.equal(kb.grammar.irregularVerbs.get('arose'), 'arise');
});

test('domain lexicons are populated', () => {
  const { domain } = kb;
  assert.ok(domain.colours.size > 150);
  assert.ok(domain.colours.has('red'));
  assert.ok(domain.colours.has('grey') && domain.colours.has('gray'));
  assert.ok(domain.shades.has('dark') && domain.shades.has('pale') && domain.shades.has('bright'));
  assert.ok(kb.meta.discoveredWorlds.length >= 15);
  assert.ok(kb.meta.enShardsLoaded >= 50);
  assert.ok(kb.meta.framesCount >= 400);
  assert.ok(kb.meta.lexiconsCount >= 30);
  assert.ok(kb.grammar.lexicons.has('diagram.kind'));
  assert.ok(kb.grammar.lexicons.has('name.letter.after'));
  assert.ok(kb.grammar.ellipsis.repeats.size >= 5);
  assert.ok(domain.objects.size > 1000);
  assert.ok(domain.objects.has('house') && domain.objects.has('cat'));
  assert.ok(domain.bodyParts.size > 50);
  assert.ok(domain.bodyParts.has('hair') && domain.bodyParts.has('eyes') && domain.bodyParts.has('nose'));
  assert.ok(domain.comparatives.size > 50);
  assert.equal(domain.comparatives.get('bigger')?.scale, 'size');
  assert.ok(domain.scales.has('tiny'));
  assert.ok(domain.directions.has('left'));
  assert.ok(domain.positions.has('top left'));
  assert.ok(domain.scenes.size > 100);
  assert.ok(domain.shapes.size > 50);
  assert.ok(domain.layouts.size >= 15);
  assert.ok(domain.styles.size >= 30);
  assert.ok(domain.diagrams.size >= 10);
  assert.ok(domain.charts.size >= 10);
  assert.ok(domain.genres.size >= 10);
  assert.ok(domain.units.size > 50);
  assert.ok(domain.feelings.size >= 25);
  assert.ok(domain.wearables.size >= 80);
  assert.equal(domain.time.months.get('jan'), 'January');
  assert.equal(domain.time.weekdays.get('monday'), 'Monday');
  assert.ok(domain.time.partsOfDay.has('morning'));
  assert.ok(domain.time.relativeDays.has('tomorrow'));
  assert.ok(domain.givenNames.size > 1000);
});
