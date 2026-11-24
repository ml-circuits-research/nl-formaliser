// Knowledge Loader for nl-formaliser.
// Reads w.request keys, k.actions, w.lang.en grammar/cues/morphology, domain shards,
// and docs/worlds/vocab-kinds.json (avoiding 400+ heavy geometry shards) in < 1.5s.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TABS, defaultOnFor, unquoteSop } from '../contracts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SPELLING_PAIRS = [
  ['colour', 'color'],
  ['colours', 'colors'],
  ['centre', 'center'],
  ['labelled', 'labeled'],
  ['grey', 'gray'],
  ['organise', 'organize'],
  ['organisation', 'organization'],
  ['customise', 'customize'],
  ['behaviour', 'behavior'],
  ['favour', 'favor'],
  ['neighbour', 'neighbor'],
  ['finalise', 'finalize'],
  ['normalise', 'normalize'],
  ['visualise', 'visualize'],
];

const FINER_ACT_MODES = [
  ['arrange', 'place', 'arrange'],
  ['align', 'place', 'arrange'],
  ['line up', 'place', 'arrange'],
  ['distribute', 'place', 'arrange'],
  ['space', 'place', 'arrange'],
  ['order', 'place', 'arrange'],
  ['sort', 'place', 'arrange'],
  ['organize', 'place', 'arrange'],
  ['organise', 'place', 'arrange'],
  ['merge', 'group', 'merge'],
  ['combine', 'group', 'merge'],
  ['ungroup', 'take apart', 'ungroup'],
  ['split', 'take apart', 'split'],
  ['disconnect', 'take apart', 'disconnect'],
  ['unlink', 'take apart', 'disconnect'],
  ['detach', 'take apart', 'disconnect'],
  ['reverse', 'change', 'reverse'],
  ['flip', 'change', 'reverse'],
  ['invert', 'change', 'reverse'],
  ['set', 'change', 'set'],
  ['repeat', 'copy', 'repeat'],
];

// Mapping from world/concept `means` prefixes in w.*/shards/words.sop to tab families.
const MEANS_TO_TAB_FAMILY = {
  drawing: {
    'w.drawing': 'drawn',
    'w.drawing.object': 'drawn',
    'w.drawing.part': 'part',
    'w.drawing.group': 'group',
    'w.drawing.page': 'page',
    'w.drawing.composition': 'composition',
    'w.face': 'drawn',
    'w.person': 'drawn',
  },
  diagram: {
    'w.diagram': 'diagram',
    'w.diagram.diagram': 'diagram',
    'w.diagram.node': 'node',
    'w.diagram.edge': 'link',
    'w.diagram.link': 'link',
    'w.diagram.group': 'group',
    'w.diagram.page': 'page',
    'w.diagram.chart': 'chart',
    'w.chart': 'chart',
    'w.chart.chart': 'chart',
    'w.chart.series': 'series',
    'w.chart.point': 'point',
  },
  document: {
    'w.document': 'document',
    'w.document.document': 'document',
    'w.document.section': 'section',
    'w.document.chapter': 'section',
    'w.document.paragraph': 'block',
    'w.document.block': 'block',
    'w.document.inline': 'inline',
    'w.document.text': 'text',
    'w.text': 'text',
  },
  calendar: {
    'w.calendar': 'calendar',
    'w.calendar.calendar': 'calendar',
    'w.calendar.event': 'meeting',
    'w.calendar.meeting': 'meeting',
    'w.calendar.room': 'room',
    'w.calendar.person': 'person',
    'w.meetings': 'meeting',
    'w.meetings.meeting': 'meeting',
  },
};

const FAMILY_SYNONYMS = {
  drawn: ['avatar', 'avatars', 'face', 'faces', 'figure', 'figures', 'person', 'people', 'object', 'objects', 'thing', 'things', 'drawing', 'drawings', 'character', 'characters', 'animal', 'animals', 'item', 'items', 'shape', 'shapes', 'portrait', 'portraits'],
  chart: ['chart', 'charts', 'graph', 'graphs', 'plot', 'plots'],
  node: ['node', 'nodes', 'box', 'boxes', 'shape', 'shapes', 'step', 'steps', 'stage', 'stages', 'bubble', 'bubbles', 'element', 'elements'],
  link: ['link', 'links', 'arrow', 'arrows', 'edge', 'edges', 'connector', 'connectors', 'line', 'lines', 'connection', 'connections'],
  meeting: ['meeting', 'meetings', 'event', 'events', 'appointment', 'appointments', 'session', 'sessions'],
  text: ['text', 'texts', 'doc', 'docs', 'file', 'files', 'document', 'documents', 'story', 'stories', 'essay', 'essays', 'report', 'reports', 'article', 'articles'],
  document: ['document', 'documents', 'doc', 'docs', 'file', 'files'],
  section: ['section', 'sections', 'heading', 'headings', 'paragraph', 'paragraphs', 'chapter', 'chapters', 'subsection', 'subsections'],
  block: ['block', 'blocks', 'heading', 'headings', 'paragraph', 'paragraphs', 'list', 'lists', 'quote', 'quotes', 'table', 'tables'],
  page: ['page', 'pages', 'canvas', 'picture', 'scene', 'background', 'backdrop'],
  part: ['part', 'parts', 'body', 'feature', 'features', 'component', 'components'],
  group: ['group', 'groups', 'cluster', 'clusters', 'set', 'sets'],
  diagram: ['diagram', 'diagrams', 'flowchart', 'flowcharts'],
  calendar: ['calendar', 'calendars', 'schedule', 'schedules', 'agenda'],
  room: ['room', 'rooms', 'location', 'locations', 'venue', 'venues'],
  person: ['person', 'people', 'attendee', 'attendees', 'participant', 'participants', 'member', 'members'],
  series: ['series', 'dataset', 'datasets'],
  point: ['point', 'points', 'datapoint', 'datapoints'],
  inline: ['inline', 'span', 'spans', 'formatting'],
  composition: ['composition', 'compositions', 'collage'],
  preference: ['preference', 'preferences', 'default', 'defaults', 'setting', 'settings'],
  step: ['step', 'steps'],
  sketch: ['sketch', 'sketches'],
};

const HARD_FILLER_PHRASES = [
  'thank you', 'thanks', 'can you', 'could you', 'would you', 'will you',
  'could you please', 'can you please', 'would you please', 'will you please',
  'i want', "i'd like", 'i would like', 'i need', "let's", 'let us',
  'please could you', 'please can you', 'do you think you could',
  'if you can', 'if possible', 'by the way', 'for me', 'just',
];

const SHADE_WORDS = [
  'light', 'dark', 'pale', 'bright', 'deep', 'soft',
  'pastel', 'neon', 'vivid', 'muted', 'warm', 'cool',
];

const AVATAR_PART_WORDS = [
  'hair', 'eyes', 'eye', 'nose', 'mouth', 'eyebrows', 'brows', 'ears', 'ear',
  'beard', 'moustache', 'mustache', 'glasses', 'hat', 'headwear', 'clothes',
  'shirt', 'shoulders', 'skin', 'cheeks', 'lips', 'teeth',
  'chin', 'neck', 'hands', 'arms', 'legs', 'feet',
];

const QUANTIFIER_SPECS = {
  all: { quantifier: 'all', quantity: 'all', fill: 'all' },
  every: { quantifier: 'every', quantity: 'all', fill: 'all' },
  both: { quantifier: 'both', quantity: 'two' },
  each: { quantifier: 'each', quantity: 'all', fill: 'all' },
  any: { quantifier: 'any', quantity: 'some' },
  some: { quantifier: 'some', quantity: 'some' },
  most: { quantifier: 'most', quantity: 'most' },
  half: { quantifier: 'half', quantity: 'half' },
  none: { quantifier: 'none', quantity: 'none' },
  several: { quantifier: 'several', quantity: 'several' },
  few: { quantifier: 'few', quantity: 'few' },
  many: { quantifier: 'many', quantity: 'many' },
};

const ORDINAL_ALIASES = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
  first: 'first', second: 'second', third: 'third', fourth: 'fourth', fifth: 'fifth',
  sixth: 'sixth', seventh: 'seventh', eighth: 'eighth', ninth: 'ninth', tenth: 'tenth',
  last: 'last', final: 'last',
  'second last': 'second_last', 'second-last': 'second_last',
  'second to last': 'second_last', 'next to last': 'second_last', penultimate: 'second_last',
  newest: 'newest', latest: 'newest', 'most recent': 'newest',
  oldest: 'oldest', earliest: 'oldest',
  leftmost: 'leftmost', rightmost: 'rightmost', topmost: 'topmost', bottommost: 'bottommost',
};

const one = (w, k) => (w.attrs[k]?.[0] !== undefined ? unquoteSop(w.attrs[k][0]) : undefined);
const many = (w, k) => (w.attrs[k] ?? []).map(unquoteSop);

function parseShard(parse, filePath) {
  if (!existsSync(filePath)) return [];
  return parse(readFileSync(filePath, 'utf8'));
}

function addToSetMap(map, key, val) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(val);
}

function addSpellingVariants(targetSet, phrase) {
  for (const [uk, us] of SPELLING_PAIRS) {
    const reUk = new RegExp(`\\b${uk}\\b`, 'g');
    const reUs = new RegExp(`\\b${us}\\b`, 'g');
    if (reUk.test(phrase)) targetSet.add(phrase.replace(reUk, us));
    if (reUs.test(phrase)) targetSet.add(phrase.replace(reUs, uk));
  }
}

function expandKeyWords(shortName, means, meansToWords) {
  const words = new Set();
  const rawLower = shortName.toLowerCase();
  const spaced = shortName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
  const joined = spaced.replace(/\s+/g, '');

  words.add(rawLower);
  if (spaced) words.add(spaced);
  if (joined && joined !== rawLower) words.add(joined);
  if (/^[xy] /.test(spaced)) words.add(spaced.replace(/^([xy]) /, '$1 axis '));

  if (means && meansToWords.has(means)) {
    for (const w of meansToWords.get(means)) words.add(w);
  }

  for (const phrase of [...words]) {
    addSpellingVariants(words, phrase);
  }
  return words;
}

function buildTabs(parse, worldsDir) {
  const meansToWords = new Map();
  const wordWorlds = ['w.drawing', 'w.diagram', 'w.document', 'w.calendar', 'w.face', 'w.chart', 'w.meetings', 'w.text', 'w.person'];
  const wordWiresByWorld = new Map();

  for (const wName of wordWorlds) {
    const wires = parseShard(parse, join(worldsDir, wName, 'shards', 'words.sop'));
    wordWiresByWorld.set(wName, wires);
    for (const w of wires) {
      if (w.type !== 'core.word') continue;
      const m = one(w, 'means');
      if (!m) continue;
      for (const t of many(w, 'text')) {
        addToSetMap(meansToWords, m, t.toLowerCase());
      }
    }
  }

  const keyWires = parseShard(parse, join(worldsDir, 'w.request', 'shards', 'keys.sop'))
    .filter((w) => w.type === 'w.request.key');

  const rawByTab = Object.fromEntries(TABS.map((t) => [t, []]));
  for (const w of keyWires) {
    const tab = one(w, 'tab');
    if (rawByTab[tab]) rawByTab[tab].push(w);
  }

  const tabs = {};
  for (const tab of TABS) {
    const keys = new Map();
    const keyList = [];
    const attrToId = new Map();
    const keysByFamily = new Map();
    const keyWordIndex = new Map();
    const closedValueIndex = new Map();
    const familyWords = new Map();
    const familySet = new Set();

    for (const w of rawByTab[tab]) {
      const name = one(w, 'name');
      const family = one(w, 'family');
      const head = one(w, 'head') ?? '';
      const about = one(w, 'about') ?? '';
      const means = one(w, 'means') ?? '';
      const valuesRaw = many(w, 'value');
      const values = valuesRaw.length ? new Set(valuesRaw.map((v) => v.toLowerCase())) : null;
      const shortName = name.includes('.') ? name.split('.').slice(1).join('.') : name;
      const id = keyList.length;
      const keyWords = expandKeyWords(shortName, means, meansToWords);
      // Clean keyWords: never treat a closed value of the key (e.g. rectangle, circle, start, end),
      // a bare preposition/grammar word (in, on, of, to, from, at, by, for, with), or a bare family noun
      // (chart, drawing, diagram, group, node, section, block, meeting, calendar, document, page, part)
      // as a standalone attribute keyWord!
      const BAD_SINGLE_KW = new Set([
        'in', 'on', 'at', 'of', 'to', 'from', 'by', 'for', 'with', 'as', 'under', 'below', 'above',
        'into', 'onto', 'over', 'out', 'up', 'down', 'off', 'about', 'through', 'between',
        'belongs', 'says', 'is', 'are', 'be', 'has', 'have', 'the', 'a', 'an', 'it', 'its',
        'chart', 'drawing', 'diagram', 'group', 'node', 'section', 'block', 'meeting', 'calendar',
        'document', 'page', 'part', 'text', 'line', 'box', 'object', 'thing', 'item', 'step', 'place',
      ]);
      for (const kw of [...keyWords]) {
        if (BAD_SINGLE_KW.has(kw)) {
          keyWords.delete(kw);
        } else if ((shortName === 'x' || shortName === 'y') && (kw === 'horizontal' || kw === 'vertical')) {
          keyWords.delete(kw);
        } else if (values && values.has(kw) && kw !== shortName.toLowerCase()) {
          keyWords.delete(kw);
        }
      }
      // Natural prose/inclusion cue keyWords aligned with w.request schemas
      if (shortName === 'content' || (tab === 'document' && shortName === 'text')) {
        for (const w of ['saying', 'containing', 'reading', 'reads']) keyWords.add(w);
      }
      if (name === 'composition.with') {
        for (const w of ['include', 'including']) keyWords.add(w);
      }
      if (name === 'drawn.size' || name === 'node.size') {
        for (const w of ['wide', 'width', 'tall', 'height']) keyWords.add(w);
      }
      if (name === 'drawn.holds') {
        for (const w of ['holding', 'holds']) keyWords.add(w);
      }
      if (name === 'drawn.cause') {
        for (const w of ['because', 'because of']) keyWords.add(w);
      }
      if (name === 'chart.barHeight' || name === 'chart.barWidth') {
        for (const w of ['bar', 'bars']) keyWords.add(w);
      }

      const spec = {
        id,
        tab,
        family,
        name,
        shortName,
        head,
        values,
        valuesRaw,
        about,
        means,
        keyWords,
        onDefault: defaultOnFor(name),
      };

      keys.set(name, spec);
      keyList.push(spec);
      attrToId.set(name, id);
      familySet.add(family);

      if (!keysByFamily.has(family)) keysByFamily.set(family, []);
      keysByFamily.get(family).push(spec);

      for (const kw of keyWords) addToSetMap(keyWordIndex, kw, name);

      for (const rawVal of valuesRaw) {
        const valLower = rawVal.toLowerCase();
        const pushClosed = (form, exact) => {
          let list = closedValueIndex.get(form);
          if (!list) {
            list = [];
            closedValueIndex.set(form, list);
          }
          if (!list.some((x) => x.attr === name && x.value === rawVal && x.exact === exact)) {
            list.push({ attr: name, value: rawVal, family, exact });
          }
        };
        pushClosed(valLower, true);
        const spacedVal = valLower.replace(/_/g, ' ');
        const underscoredVal = valLower.replace(/\s+/g, '_');
        if (spacedVal !== valLower) pushClosed(spacedVal, false);
        if (underscoredVal !== valLower) pushClosed(underscoredVal, false);
        const variants = new Set();
        addSpellingVariants(variants, valLower);
        if (spacedVal !== valLower) addSpellingVariants(variants, spacedVal);
        for (const v of variants) {
          if (v !== valLower && v !== spacedVal) pushClosed(v, false);
        }
      }
    }

    const families = [...familySet].sort();
    for (const fam of families) {
      addToSetMap(familyWords, fam, fam);
      for (const syn of FAMILY_SYNONYMS[fam] ?? []) {
        addToSetMap(familyWords, syn, fam);
      }
    }
    const tabMeansMap = MEANS_TO_TAB_FAMILY[tab] ?? {};
    for (const [m, fam] of Object.entries(tabMeansMap)) {
      if (!familySet.has(fam) || !meansToWords.has(m)) continue;
      for (const word of meansToWords.get(m)) {
        // Never pollute an exact canonical family name (e.g. "calendar") with a different family ("meeting")
        if (familySet.has(word) && word !== fam) continue;
        addToSetMap(familyWords, word, fam);
      }
    }

    tabs[tab] = {
      families,
      familySet,
      keys,
      keyList,
      attrToId,
      keysByFamily,
      keyWordIndex,
      closedValueIndex,
      familyWords,
    };
  }

  return tabs;
}

function loadActions(parse, worldsDir) {
  const actionsDir = join(worldsDir, 'k.actions', 'shards');
  const acts = new Set();
  const verbs = new Map();
  const markings = new Map();

  for (const w of parseShard(parse, join(actionsDir, 'acts.sop'))) {
    if (w.type === 'k.actions.act' && w.attrs.name?.[0]) {
      acts.add(one(w, 'name'));
    }
  }

  if (existsSync(actionsDir)) {
    const files = readdirSync(actionsDir).filter((f) => f.endsWith('.sop')).sort();
    for (const f of files) {
      for (const w of parseShard(parse, join(actionsDir, f))) {
        if (w.type === 'k.actions.verb' && f.startsWith('verbs-') && w.attrs.text?.[0] && w.attrs.act?.[0]) {
          const text = one(w, 'text').toLowerCase();
          const entry = { text, act: one(w, 'act') };
          if (w.attrs.attribute?.[0]) entry.attribute = one(w, 'attribute');
          if (w.attrs.value?.[0]) entry.value = one(w, 'value');
          if (w.attrs.separable?.[0]) entry.separable = one(w, 'separable') === 'true';
          if (w.attrs.after_particle?.[0]) entry.afterParticle = one(w, 'after_particle');
          if (!verbs.has(text)) verbs.set(text, []);
          verbs.get(text).push(entry);
        } else if (w.type === 'k.actions.marking' && w.attrs.verb?.[0]) {
          const verb = one(w, 'verb').toLowerCase();
          const mEntry = {
            verb,
            act: one(w, 'act') ?? '',
            marker: one(w, 'marker') ?? '',
            role: one(w, 'role') ?? '',
          };
          if (!markings.has(verb)) markings.set(verb, []);
          markings.get(verb).push(mEntry);
        }
      }
    }
  }

  for (const [text, act, mode] of FINER_ACT_MODES) {
    if (!verbs.has(text)) verbs.set(text, []);
    const list = verbs.get(text);
    if (text === 'set') {
      if (!list.some((e) => e.act === act && e.mode === mode)) {
        list.push({ text, act, mode });
      }
      continue;
    }
    const existing = list.find((e) => e.act === act && !e.mode);
    if (existing) {
      existing.mode = mode;
    } else if (!list.some((e) => e.act === act && e.mode === mode)) {
      list.push({ text, act, mode });
    }
  }

  // Domain-standard verbs from w.request / k.actions usage that may be missing or under-licensed in verbs-*.sop
  const EXTRA_VERB_LICENSES = [
    ['book', 'make', null],
    ['schedule', 'make', null],
    ['plan', 'make', null],
    ['reserve', 'make', null],
    ['reschedule', 'place', null],
    ['reschedule', 'change', null],
    ['postpone', 'place', null],
    ['delay', 'place', null],
    ['cancel', 'remove', null],
    ['bin', 'remove', null],
    ['trash', 'remove', null],
    ['scrap', 'remove', null],
    ['discard', 'remove', null],
    ['compose', 'make', null],
    ['draft', 'make', null],
    ['write', 'make', null],
    ['author', 'make', null],
    ['plot', 'make', null],
    ['visualize', 'make', null],
    ['visualise', 'make', null],
    ['display', 'make', null],
    ['show', 'make', null],
    ['show', 'ask', null],
    ['try', 'make', null],
    ['insert', 'make', null],
    ['meet', 'make', null],
    ['invite', 'change', null],
    ['rename', 'change', null],
    ['retitle', 'change', null],
    ['relabel', 'change', null],
    ['recolour', 'change', null],
    ['recolor', 'change', null],
    ['resize', 'change', null],
    ['enlarge', 'change', null],
    ['shrink', 'change', null],
    ['widen', 'change', null],
    ['narrow', 'change', null],
    ['thicken', 'change', null],
    ['shorten', 'change', null],
    ['lengthen', 'change', null],
    ['bold', 'change', null],
    ['italicize', 'change', null],
    ['italicise', 'change', null],
    ['underline', 'change', null],
    ['highlight', 'change', null],
    ['center', 'change', null],
    ['centre', 'change', null],
    ['justify', 'change', null],
    ['give', 'change', null],
    ['give', 'place', null],
    ['give', 'make', null],
  ];
  for (const [text, act, mode] of EXTRA_VERB_LICENSES) {
    if (!verbs.has(text)) verbs.set(text, []);
    const list = verbs.get(text);
    if (!list.some((e) => e.act === act && (e.mode ?? null) === mode)) {
      list.push(mode ? { text, act, mode } : { text, act });
    }
  }

  return { acts, verbs, markings };
}

function mapDetKind(kind, definite) {
  if (kind === 'possessive') return 'possessive';
  if (kind === 'demonstrative') return 'demonstrative';
  if (kind === 'quantifier' || kind === 'numeral') return 'quantified';
  if (kind === 'article') return definite === 'yes' ? 'definite' : 'indefinite';
  return 'indefinite';
}

function loadGrammar(parse, worldsDir) {
  const enDir = join(worldsDir, 'w.lang.en', 'shards');
  const grammarWords = new Set();
  const fillerWords = new Set();
  const contractionEndings = new Set();
  const contractions = [];
  const fillerPhrases = new Set([
    ...HARD_FILLER_PHRASES,
    'that would help',
    'that helps',
    'i appreciate it',
    'appreciate it',
    'much appreciated',
    'thank you so much',
    'thanks a lot',
    'thanks so much',
    'if possible',
    'if you can',
    'if you could',
    'i need you to',
    'i want you to',
    'as drawn so far',
    'drawn so far',
    'when you get a chance',
    'if you get a chance',
    'this time',
    'for me',
    'please and thanks',
    'that works',
    'no problem',
    'cheers',
    'all good',
    'sounds good',
    'looks good',
    'never mind',
    'nevermind',
    "that's all",
    "that's it",
    'that is it',
  ]);
  const determiners = new Map();
  const pronouns = new Map();
  const prepositions = new Map();
  const joiners = new Map();
  const whWords = new Map();
  const auxiliaries = new Set();
  const negations = new Map();
  const cues = [];
  const numbers = new Map();
  const ordinals = new Map(Object.entries(ORDINAL_ALIASES));
  const quantifiers = new Map(Object.entries(QUANTIFIER_SPECS));
  const irregularPlurals = new Map();
  const irregularVerbs = new Map();

  // Exact LEX shards + required grammar/morphology/cue shards (avoids parsing large frame shards).
  const enShards = [
    'closed-classes.sop',
    'determiners.sop',
    'pronouns.sop',
    'prepositions.sop',
    'clauses.sop',
    'hand-cues.sop',
    'hand-cues-more.sop',
    'hand-cues-step.sop',
    'hand-request.sop',
    'numbers.sop',
    'number-words.sop',
    'morphology.sop',
    'hand-morphology.sop',
    'core-plurals.sop',
    'catalog-plurals.sop',
    'irregular-forms.sop',
    'phrases.sop',
  ];

  const CLOSED_GRAMMAR_CLASSES = new Set([
    'determiner', 'pronoun', 'preposition', 'conjunction', 'auxiliary', 'particle', 'adverb',
  ]);
  const SKIP_FILLER_CLASSES = new Set(['politeness', 'filler', 'desire']);

  for (const file of enShards) {
    for (const w of parseShard(parse, join(enDir, file))) {
      const cls = one(w, 'class') ?? '';
      const texts = many(w, 'text').map((t) => t.toLowerCase());

      // Exact check.mjs LEX logic
      if (w.type === 'w.lang.en.closed' && CLOSED_GRAMMAR_CLASSES.has(cls)) {
        for (const t of texts) grammarWords.add(t);
      }
      if (w.type === 'w.lang.en.closed' && cls === 'interjection') {
        for (const t of texts) fillerWords.add(t);
      }
      if (w.type === 'w.lang.en.skip') {
        for (const t of texts) {
          if (SKIP_FILLER_CLASSES.has(cls)) {
            fillerWords.add(t);
            if (t.includes(' ')) fillerPhrases.add(t);
          } else {
            grammarWords.add(t);
          }
        }
      }
      if (w.type === 'w.lang.en.imperative.lead') {
        for (const t of texts) grammarWords.add(t);
      }
      if (w.type === 'w.lang.en.contraction' && texts[0] && w.attrs.expands?.[0]) {
        contractions.push([texts[0], one(w, 'expands').toLowerCase()]);
      }
      if (w.type === 'w.lang.en.contraction.ending' && w.attrs.ending?.[0]) {
        contractionEndings.add(one(w, 'ending').toLowerCase());
      }

      if (w.type === 'w.lang.en.phrase' && one(w, 'group') === 'politeness and fillers') {
        for (const item of many(w, 'item')) {
          const phrase = item.toLowerCase();
          if (phrase.includes(' ')) fillerPhrases.add(phrase);
        }
      }

      if (w.type === 'w.lang.en.det') {
        const det = mapDetKind(one(w, 'kind'), one(w, 'definite'));
        const num = one(w, 'number');
        for (const t of texts) {
          const info = { det };
          if (num) info.number = num;
          determiners.set(t, info);
        }
      }

      if (w.type === 'w.lang.en.pron') {
        const kind = one(w, 'refers') ?? one(w, 'case') ?? 'pronoun';
        const num = one(w, 'number');
        for (const t of texts) {
          const info = { kind };
          if (num) info.number = num;
          pronouns.set(t, info);
        }
      }

      if (w.type === 'w.lang.en.prep' || w.type === 'w.lang.en.prep.time') {
        const rel = one(w, 'rel') ?? texts[0] ?? '';
        const space = one(w, 'space');
        const role = one(w, 'order') ?? one(w, 'role');
        const isTime = w.type === 'w.lang.en.prep.time' || many(w, 'in').includes('time');
        for (const t of texts) {
          const info = { rel };
          if (space) info.space = space;
          if (role) info.role = role;
          if (isTime) info.isTime = true;
          prepositions.set(t, info);
        }
      }

      if (w.type === 'w.lang.en.joiner') {
        const kind = one(w, 'kind') ?? '';
        const cut = one(w, 'cut') ?? 'no';
        for (const t of texts) joiners.set(t, { kind, cut });
      }

      if (w.type === 'w.lang.en.wh') {
        const asks = one(w, 'asks') ?? '';
        for (const t of texts) whWords.set(t, { asks });
      }

      if (w.type === 'w.lang.en.aux') {
        for (const t of texts) auxiliaries.add(t);
      }

      if (w.type === 'w.lang.en.neg') {
        for (const t of texts) negations.set(t, { want: 'no' });
      }

      if (w.type === 'w.lang.en.cue') {
        cues.push({
          name: one(w, 'name') ?? '',
          on: one(w, 'on') ?? '',
          want: one(w, 'want'),
          attribute: one(w, 'attribute'),
          value: one(w, 'value'),
          relation: one(w, 'relation'),
          step: one(w, 'step'),
          lead: many(w, 'lead').map((x) => x.toLowerCase()),
          takes: one(w, 'takes'),
          priority: w.attrs.priority?.[0] ? Number(one(w, 'priority')) : undefined,
        });
      }

      if (w.type === 'w.lang.en.numeral' && w.attrs.value?.[0]) {
        const val = Number(one(w, 'value'));
        if (!Number.isNaN(val)) {
          for (const t of texts) numbers.set(t, { value: val, ordinal: false });
        }
      }

      if (w.type === 'w.lang.en.ordinal' && w.attrs.value?.[0]) {
        const val = Number(one(w, 'value'));
        for (const t of texts) {
          if (!Number.isNaN(val)) numbers.set(t, { value: val, ordinal: true });
          if (!ordinals.has(t)) ordinals.set(t, t);
        }
      }

      if (w.type === 'w.lang.en.number' && w.attrs.value?.[0]) {
        const kind = one(w, 'kind');
        const val = Number(one(w, 'value'));
        if (!Number.isNaN(val) && (kind === 'cardinal' || kind === 'ordinal')) {
          const isOrd = kind === 'ordinal';
          for (const t of texts) {
            if (!numbers.has(t)) numbers.set(t, { value: val, ordinal: isOrd });
            if (isOrd && !ordinals.has(t)) ordinals.set(t, t);
          }
        }
      }

      if (w.type === 'w.lang.en.lex' && one(w, 'name') === 'lang.ordinal') {
        for (const item of many(w, 'item')) {
          const low = item.toLowerCase();
          if (!ordinals.has(low)) ordinals.set(low, low.replace(/\s+/g, '_'));
        }
      }

      if (w.type === 'w.lang.en.irregular' && w.attrs.singular?.[0] && w.attrs.plural?.[0]) {
        const sg = one(w, 'singular').toLowerCase();
        for (const pl of many(w, 'plural')) {
          const pLow = pl.toLowerCase();
          if (!irregularPlurals.has(pLow)) irregularPlurals.set(pLow, sg);
        }
      }

      if (w.type === 'w.lang.en.irregular_form' && w.attrs.lemma?.[0] && w.attrs.form?.[0]) {
        const lemma = one(w, 'lemma').toLowerCase();
        const form = one(w, 'form').toLowerCase();
        if (w.attrs.vform) {
          if (!irregularVerbs.has(form)) irregularVerbs.set(form, lemma);
        } else if (one(w, 'num') === 'pl') {
          if (!irregularPlurals.has(form)) irregularPlurals.set(form, lemma);
        }
      }
    }
  }

  for (const [t, e] of contractions) {
    if (e.split(/\s+/).every((x) => grammarWords.has(x))) grammarWords.add(t);
  }

  negations.set('not all', { want: 'not_all' });
  negations.set('not only', { want: 'not_all' });
  negations.set('not every', { want: 'not_all' });

  return {
    grammarWords,
    fillerWords,
    contractionEndings,
    contractions,
    fillerPhrases,
    determiners,
    pronouns,
    prepositions,
    joiners,
    whWords,
    auxiliaries,
    negations,
    cues,
    numbers,
    ordinals,
    quantifiers,
    irregularPlurals,
    irregularVerbs,
  };
}

function loadSimpleNameMap(parse, filePaths, wireType, map) {
  for (const p of filePaths) {
    for (const w of parseShard(parse, p)) {
      if (w.type === wireType && w.attrs.name?.[0]) {
        const canon = one(w, 'name');
        map.set(canon.toLowerCase(), canon);
      } else if (w.type === 'core.word' && w.attrs.means?.[0] && w.attrs.of?.[0] === `${wireType}.name`) {
        const canon = one(w, 'means');
        for (const t of many(w, 'text')) {
          const low = t.toLowerCase();
          if (!map.has(low)) map.set(low, canon);
        }
      }
    }
  }
}

function loadDomain(parse, worldsDir, vocabKinds, grammar, tabs) {
  const colours = new Map();
  const shades = new Set(SHADE_WORDS);
  const shapes = new Map();
  const scales = new Map();
  const comparatives = new Map();
  const directions = new Map();
  const positions = new Map();
  const objects = new Map();
  const bodyParts = new Map();
  const wearables = new Map();
  const feelings = new Map();
  const scenes = new Map();
  const layouts = new Map();
  const styles = new Map();
  const diagrams = new Map();
  const charts = new Map();
  const genres = new Map();
  const units = new Map();
  const givenNames = new Set();

  // Colours
  loadSimpleNameMap(
    parse,
    ['colours.sop', 'colours-common.sop', 'colours-css.sop', 'words.sop'].map((f) => join(worldsDir, 'k.colours', 'shards', f)),
    'k.colours.colour',
    colours,
  );
  for (const [k, v] of [...colours.entries()]) {
    if (k.includes('grey')) colours.set(k.replace(/grey/g, 'gray'), v);
    if (k.includes('gray')) colours.set(k.replace(/gray/g, 'grey'), v);
  }
  colours.set('grey', colours.get('grey') ?? 'grey');
  colours.set('gray', colours.get('gray') ?? 'gray');

  // Shades from k.values/psys2.sop
  for (const w of parseShard(parse, join(worldsDir, 'k.values', 'shards', 'psys2.sop'))) {
    if (w.type === 'k.values.shade' && w.attrs.name?.[0]) {
      shades.add(one(w, 'name').toLowerCase());
    }
  }

  // Shapes
  loadSimpleNameMap(
    parse,
    ['shapes.sop', 'psys2.sop', 'words.sop'].map((f) => join(worldsDir, 'k.shapes', 'shards', f)),
    'k.shapes.shape',
    shapes,
  );

  // Scales & Comparatives
  for (const w of parseShard(parse, join(worldsDir, 'k.values', 'shards', 'scales.sop'))) {
    if (w.type === 'k.values.step' && w.attrs.name?.[0]) {
      const step = one(w, 'name');
      scales.set(step.toLowerCase(), {
        scale: one(w, 'scale') ?? '',
        step,
        rank: Number(one(w, 'rank') ?? 0),
      });
    } else if (w.type === 'core.word' && one(w, 'of') === 'k.values.step.name') {
      const targetStep = one(w, 'means')?.toLowerCase();
      const entry = targetStep ? scales.get(targetStep) : undefined;
      if (entry) {
        for (const t of many(w, 'text')) {
          if (!scales.has(t.toLowerCase())) scales.set(t.toLowerCase(), entry);
        }
      }
    } else if (w.type === 'k.values.comparative' && w.attrs.text?.[0]) {
      const entry = {
        scale: one(w, 'scale') ?? '',
        way: one(w, 'way') ?? '',
        degree: one(w, 'degree') ?? 'comparative',
      };
      for (const t of many(w, 'text')) comparatives.set(t.toLowerCase(), entry);
    }
  }

  // Directions & Positions
  for (const w of parseShard(parse, join(worldsDir, 'k.values', 'shards', 'directions.sop'))) {
    if (w.type === 'k.values.direction' && w.attrs.name?.[0]) {
      const canon = one(w, 'name');
      directions.set(canon.toLowerCase(), canon);
    } else if (w.type === 'core.word' && one(w, 'of') === 'k.values.direction.name') {
      const canon = one(w, 'means');
      for (const t of many(w, 'text')) {
        if (!directions.has(t.toLowerCase())) directions.set(t.toLowerCase(), canon);
      }
    } else if (w.type === 'k.values.position' && w.attrs.name?.[0]) {
      const canon = one(w, 'name').replace(/\s+/g, '_');
      const raw = one(w, 'name').toLowerCase();
      positions.set(raw, canon);
      positions.set(canon.toLowerCase(), canon);
    } else if (w.type === 'core.word' && one(w, 'of') === 'k.values.position.name') {
      const canon = one(w, 'means').replace(/\s+/g, '_');
      for (const t of many(w, 'text')) {
        if (!positions.has(t.toLowerCase())) positions.set(t.toLowerCase(), canon);
      }
    }
  }
  for (const cue of grammar.cues) {
    if (cue.on === 'place' && cue.value) {
      for (const l of cue.lead) {
        if (!positions.has(l)) positions.set(l, cue.value);
      }
    }
  }

  // Body parts, wearables, feelings, styles, layouts, diagrams, charts, genres, units
  loadSimpleNameMap(parse, ['core.sop', 'words.sop'].map((f) => join(worldsDir, 'k.body', 'shards', f)), 'k.body.part', bodyParts);
  for (const w of parseShard(parse, join(worldsDir, 'k.faces', 'shards', 'slots.sop'))) {
    if (w.type === 'k.faces.slot' && w.attrs.name?.[0]) {
      const n = one(w, 'name');
      bodyParts.set(n.toLowerCase(), n);
      bodyParts.set(n.toLowerCase().replace(/_/g, ' '), n);
    }
  }
  for (const p of AVATAR_PART_WORDS) {
    if (!bodyParts.has(p)) bodyParts.set(p, p);
  }

  loadSimpleNameMap(parse, ['wearables.sop', 'words.sop'].map((f) => join(worldsDir, 'k.wearables', 'shards', f)), 'k.wearables.wearable', wearables);
  loadSimpleNameMap(parse, ['feelings.sop', 'words.sop'].map((f) => join(worldsDir, 'k.feelings', 'shards', f)), 'k.feelings.feeling', feelings);
  loadSimpleNameMap(parse, ['layouts.sop', 'words.sop'].map((f) => join(worldsDir, 'k.layouts', 'shards', f)), 'k.layouts.layout', layouts);

  // Styles
  for (const f of ['drawing.sop', 'materials.sop', 'themes.sop', 'words.sop']) {
    for (const w of parseShard(parse, join(worldsDir, 'k.styles', 'shards', f))) {
      if (w.type.startsWith('k.styles.') && w.attrs.name?.[0]) {
        const kind = w.type.slice('k.styles.'.length);
        const name = one(w, 'name');
        styles.set(name.toLowerCase(), { kind, name });
      } else if (w.type === 'core.word' && w.attrs.means?.[0] && w.attrs.of?.[0]?.startsWith('k.styles.')) {
        const kind = one(w, 'of').split('.')[2] ?? 'style';
        const name = one(w, 'means');
        for (const t of many(w, 'text')) {
          if (!styles.has(t.toLowerCase())) styles.set(t.toLowerCase(), { kind, name });
        }
      }
    }
  }

  // Diagrams
  for (const f of ['diagrams.sop', 'words.sop']) {
    for (const w of parseShard(parse, join(worldsDir, 'k.diagrams', 'shards', f))) {
      if (w.type === 'k.diagrams.kind' && w.attrs.name?.[0]) {
        const name = one(w, 'name');
        const form = one(w, 'form') ?? name;
        diagrams.set(name.toLowerCase(), form);
        diagrams.set(form.toLowerCase(), form);
      } else if (w.type === 'core.word' && w.attrs.means?.[0] === 'k.diagrams.kind') {
        for (const t of many(w, 'text')) {
          if (!diagrams.has(t.toLowerCase())) diagrams.set(t.toLowerCase(), t.toLowerCase());
        }
      }
    }
  }

  // Charts
  for (const f of ['charts.sop', 'words.sop']) {
    for (const w of parseShard(parse, join(worldsDir, 'k.charts', 'shards', f))) {
      if (w.type === 'k.charts.kind' && w.attrs.name?.[0]) {
        const name = one(w, 'name');
        const form = one(w, 'form') ?? name;
        charts.set(name.toLowerCase(), form);
        charts.set(form.toLowerCase(), form);
      }
    }
  }
  const chartTypeKey = tabs.diagram?.keys.get('chart.type');
  if (chartTypeKey?.valuesRaw) {
    for (const v of chartTypeKey.valuesRaw) {
      charts.set(v.toLowerCase(), v);
      charts.set(`${v.toLowerCase()} chart`, v);
      charts.set(`${v.toLowerCase()} graph`, v);
    }
  }

  // Genres
  const genresDir = join(worldsDir, 'k.genres', 'shards');
  if (existsSync(genresDir)) {
    for (const f of readdirSync(genresDir).filter((x) => x.endsWith('.sop'))) {
      for (const w of parseShard(parse, join(genresDir, f))) {
        if (w.type === 'k.genres.genre' && w.attrs.name?.[0]) {
          const name = one(w, 'name');
          genres.set(name.toLowerCase(), name);
        } else if (w.type === 'k.genres.move' && w.attrs.name?.[0]) {
          const name = one(w, 'name');
          if (!genres.has(name.toLowerCase())) genres.set(name.toLowerCase(), name);
        } else if (w.type === 'core.word' && one(w, 'of') === 'k.genres.genre.name') {
          const canon = one(w, 'means');
          for (const t of many(w, 'text')) {
            if (!genres.has(t.toLowerCase())) genres.set(t.toLowerCase(), canon);
          }
        }
      }
    }
  }
  const genreKey = tabs.document?.keys.get('text.genre');
  if (genreKey?.valuesRaw) {
    for (const v of genreKey.valuesRaw) {
      if (!genres.has(v.toLowerCase())) genres.set(v.toLowerCase(), v);
    }
  }

  // Units
  for (const f of ['core.sop', 'words.sop']) {
    for (const w of parseShard(parse, join(worldsDir, 'k.units', 'shards', f))) {
      if (w.type === 'k.units.unit' && w.attrs.name?.[0]) {
        const name = one(w, 'name');
        const quantity = one(w, 'quantity') ?? '';
        const entry = { name, quantity };
        units.set(name.toLowerCase(), entry);
        if (w.attrs.symbol?.[0]) {
          const sym = one(w, 'symbol').toLowerCase();
          if (!units.has(sym)) units.set(sym, entry);
        }
      } else if (w.type === 'core.word' && one(w, 'of') === 'k.units.unit.name') {
        const canon = one(w, 'means');
        const existing = units.get(canon?.toLowerCase());
        const entry = existing ?? { name: canon, quantity: '' };
        for (const t of many(w, 'text')) {
          if (!units.has(t.toLowerCase())) units.set(t.toLowerCase(), entry);
        }
      }
    }
  }

  // Time
  const months = new Map();
  const weekdays = new Map();
  const partsOfDay = new Map();
  const relativeDays = new Map([
    ['today', 'today'],
    ['tomorrow', 'tomorrow'],
    ['yesterday', 'yesterday'],
    ['tonight', 'tonight'],
    ['this week', 'this_week'],
    ['next week', 'next_week'],
    ['last week', 'last_week'],
    ['this month', 'this_month'],
    ['next month', 'next_month'],
    ['last month', 'last_month'],
  ]);
  for (const f of ['calendar.sop', 'clock.sop', 'clock-words.sop', 'words.sop']) {
    for (const w of parseShard(parse, join(worldsDir, 'k.time', 'shards', f))) {
      if (w.type === 'k.time.month' && w.attrs.name?.[0]) {
        const n = one(w, 'name');
        months.set(n.toLowerCase(), n);
      } else if (w.type === 'k.time.weekday' && w.attrs.name?.[0]) {
        const n = one(w, 'name');
        weekdays.set(n.toLowerCase(), n);
      } else if ((w.type === 'k.time.part_of_day' || w.type === 'k.time.span' || w.type === 'k.time.hour') && w.attrs.name?.[0]) {
        const n = one(w, 'name');
        if (w.type !== 'k.time.span' || w.attrs.within) partsOfDay.set(n.toLowerCase(), n);
      } else if (w.type === 'core.word' && w.attrs.means?.[0]) {
        const ofType = one(w, 'of');
        const mean = one(w, 'means');
        if (ofType === 'k.time.month.name') {
          for (const t of many(w, 'text')) months.set(t.toLowerCase(), mean);
        } else if (ofType === 'k.time.weekday.name') {
          for (const t of many(w, 'text')) weekdays.set(t.toLowerCase(), mean);
        } else if (ofType === 'k.time.part_of_day.name' || ofType === 'k.time.span.name' || ofType === 'k.time.hour.name') {
          for (const t of many(w, 'text')) partsOfDay.set(t.toLowerCase(), mean);
        }
      }
    }
  }

  // Fast vocab-kinds.json extraction (replaces 400+ heavy geometry shards)
  const OBJECT_KINDS = [
    'k.objects.object', 'k.animals.animal', 'k.people.kind',
    'k.people.role', 'k.scenes.thing', 'k.wearables.wearable', 'k.shapes.shape',
  ];
  for (const [word, kinds] of Object.entries(vocabKinds)) {
    const low = word.toLowerCase();
    for (const ok of OBJECT_KINDS) {
      if (kinds[ok]) {
        if (!objects.has(low)) objects.set(low, low);
        break;
      }
    }
    if (kinds['k.body.part'] || kinds['k.wearables.wearable']) {
      if (!bodyParts.has(low)) bodyParts.set(low, low);
    }
    if (kinds['k.scenes.scene']) {
      if (!scenes.has(low)) scenes.set(low, low);
    }
    if (kinds['k.shapes.shape']) {
      if (!shapes.has(low)) shapes.set(low, low);
    }
    if (kinds['k.colours.colour']) {
      if (!colours.has(low)) colours.set(low, low);
    }
    if (kinds['k.people.given_name']) {
      givenNames.add(low);
    }
  }

  for (const w of parseShard(parse, join(worldsDir, 'k.objects', 'shards', 'words.sop'))) {
    if (w.type === 'core.word' && one(w, 'of') === 'k.objects.object.name' && w.attrs.means?.[0]) {
      const mean = one(w, 'means').toLowerCase();
      for (const t of many(w, 'text')) {
        if (!objects.has(t.toLowerCase())) objects.set(t.toLowerCase(), mean);
      }
    }
  }

  return {
    colours,
    shades,
    shapes,
    scales,
    comparatives,
    directions,
    positions,
    objects,
    bodyParts,
    wearables,
    feelings,
    scenes,
    layouts,
    styles,
    diagrams,
    charts,
    genres,
    units,
    time: { months, weekdays, partsOfDay, relativeDays },
    givenNames,
  };
}

/**
 * Load all w.request keys, k.actions, w.lang.en grammar/morphology/cues,
 * and fast domain lexicons from sop-knowledge-worlds.
 *
 * @param {object} [options]
 * @param {string} [options.knowledgeDir]
 * @returns {Promise<object>}
 */
export async function loadKnowledge({ knowledgeDir } = {}) {
  const kDir = resolve(
    knowledgeDir ?? process.env.SOP_KNOWLEDGE ?? resolve(HERE, '..', '..', '..', 'sop-knowledge-worlds'),
  );
  const sopworldPath = join(kDir, 'tools', 'sopworld', 'sopworld.mjs');
  const { parse } = await import(pathToFileURL(sopworldPath).href);
  const worldsDir = join(kDir, 'docs', 'worlds');

  const vocabPath = join(worldsDir, 'vocab-kinds.json');
  const vocabKinds = existsSync(vocabPath)
    ? JSON.parse(readFileSync(vocabPath, 'utf8'))
    : {};

  const tabs = buildTabs(parse, worldsDir);
  const { acts, verbs, markings } = loadActions(parse, worldsDir);
  const grammar = loadGrammar(parse, worldsDir);
  const domain = loadDomain(parse, worldsDir, vocabKinds, grammar, tabs);

  const normalizeToken = (word) => String(word ?? '').toLowerCase().replace(/\u2019/g, "'");

  return {
    knowledgeDir: kDir,
    sopworldPath,
    tabs,
    acts,
    verbs,
    markings,
    grammar,
    domain,
    isGrammarWord(word) {
      const x = normalizeToken(word);
      const i = x.indexOf("'");
      return (
        grammar.grammarWords.has(x) ||
        (i > 0 && grammar.grammarWords.has(x.slice(0, i)) && grammar.contractionEndings.has(x.slice(i)))
      );
    },
    isFillerWord(word) {
      const x = normalizeToken(word);
      return grammar.fillerWords.has(x) || grammar.fillerPhrases.has(x);
    },
  };
}
