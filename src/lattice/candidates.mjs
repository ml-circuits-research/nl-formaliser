// Unfiltered Lexical Lattice Builder for nl-formaliser.
//
// CRITICAL ARCHITECTURAL RULE:
// `src/lattice/` MUST NOT make semantic disambiguation decisions!
// It enumerates ALL grounded candidate interpretations over token spans from `kb`
// and leaves global disambiguation to Z3.

import {
  HYP_KINDS,
  DETERMINERS,
  defaultOnFor,
} from '../contracts.mjs';
import { lemmatiseWord, singularisePhrase } from './morph.mjs';
import { tokenize } from './tokenize.mjs';

// ---------------------------------------------------------------------------
// Polymorphic KB accessors (compatible with Map, Set, Array, or plain Object)
// ---------------------------------------------------------------------------

function mapGet(m, key) {
  if (!m) return undefined;
  if (m instanceof Map) return m.get(key);
  if (typeof m === 'object' && Object.hasOwn(m, key)) return m[key];
  return undefined;
}

function mapEntries(m) {
  if (!m) return [];
  if (m instanceof Map) return [...m.entries()];
  if (typeof m === 'object') return Object.entries(m);
  return [];
}

function toArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (x instanceof Set) return [...x];
  return [x];
}

function vocabMatch(vocab, key) {
  if (!vocab || !key) return null;
  if (vocab instanceof Set) return vocab.has(key) ? key : null;
  if (Array.isArray(vocab)) return vocab.includes(key) ? key : null;
  if (vocab instanceof Map) {
    if (!vocab.has(key)) return null;
    const v = vocab.get(key);
    return unwrapVocabValue(v, key);
  }
  if (typeof vocab === 'object' && Object.hasOwn(vocab, key)) {
    return unwrapVocabValue(vocab[key], key);
  }
  return null;
}

function unwrapVocabValue(v, fallback) {
  if (v === true) return fallback;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    return v.canonical ?? v.sort ?? v.name ?? v.step ?? v.value ?? fallback;
  }
  return null;
}

const kbCache = new WeakMap();

function getKbHelpers(kb) {
  if (kb && kbCache.has(kb)) return kbCache.get(kb);

  // Precompute separable phrasal verb index: baseVerb -> Array<{ full, particles, entries }>
  const separableIndex = new Map();
  for (const [verbText, rawEntries] of mapEntries(kb?.verbs)) {
    const parts = String(verbText).toLowerCase().trim().split(/\s+/);
    if (parts.length >= 2) {
      const head = parts[0];
      const particles = parts.slice(1);
      const entries = toArray(rawEntries);
      if (!separableIndex.has(head)) separableIndex.set(head, []);
      separableIndex.get(head).push({ full: verbText, particles, entries });
    }
  }

  // Filler phrases set — strictly filter out any phrase containing an action verb like "let us compose"
  const fillerPhrases = new Set([
    'can you',
    'could you',
    'could you please',
    'would you',
    'would you please',
    'will you',
    'thank you',
    'thanks very much',
    'thanks a lot',
    "i'd like",
    'i would like',
    'i want',
    'i want you to',
    'i need',
    'i need you to',
    "let's",
    'let us',
    'that would help',
    'i appreciate it',
    'appreciate it',
    'much appreciated',
    'if possible',
    'if you can',
    'if you could',
  ]);
  for (const ph of toArray(kb?.grammar?.fillerPhrases)) {
    const clean = String(ph).toLowerCase().replace(/\u2019/g, "'").trim();
    if (!clean) continue;
    // Only keep multi-word phrases from w.lang.en whose words are filler/grammar or known polite remarks
    const ws = clean.split(/\s+/);
    const hasContentVerb = ws.some((w) => !kb?.isGrammarWord?.(w) && !kb?.isFillerWord?.(w) && mapGet(kb?.verbs, w));
    if (!hasContentVerb || ['that would help', 'i appreciate it', 'appreciate it'].includes(clean)) {
      fillerPhrases.add(clean);
    }
  }

  // Number words map
  const numberWords = new Map([
    ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4],
    ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9],
    ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13],
    ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17],
    ['eighteen', 18], ['nineteen', 19], ['twenty', 20], ['thirty', 30],
    ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70],
    ['eighty', 80], ['ninety', 90], ['hundred', 100], ['thousand', 1000],
    ['half', 0.5], ['quarter', 0.25], ['dozen', 12], ['pair', 2], ['both', 2],
  ]);
  for (const [w, n] of mapEntries(kb?.grammar?.numbers)) {
    if (n && typeof n === 'object') {
      if (!n.ordinal && n.value !== undefined) {
        const num = Number(n.value);
        if (!Number.isNaN(num)) numberWords.set(String(w).toLowerCase(), num);
      }
    } else {
      const num = Number(n);
      if (!Number.isNaN(num)) numberWords.set(String(w).toLowerCase(), num);
    }
  }

  // Dynamically ingest official w.lang.en.cue entries from sop-knowledge-worlds (general across worlds!)
  const undoCuePhrases = new Set(['put it back', 'put back', 'go back', 'revert', 'as it was', 'edit back', 'step back']);
  const redoCuePhrases = new Set(['do it again', 'one more time', 'start over']);
  const layoutCuePhrases = new Map();
  for (const cue of toArray(kb?.grammar?.cues)) {
    const leads = toArray(cue?.lead).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
    if (cue.name === 'reaction.thanks') {
      for (const l of leads) fillerPhrases.add(l);
    } else if (cue.name === 'reaction.put_back') {
      for (const l of leads) undoCuePhrases.add(l);
    } else if (cue.name === 'reaction.redo') {
      for (const l of leads) if (l.includes(' ')) redoCuePhrases.add(l);
    } else if (cue.on === 'layout' && cue.value) {
      for (const l of leads) layoutCuePhrases.set(l, cue.value);
    }
  }

  const helpers = { separableIndex, fillerPhrases, numberWords, undoCuePhrases, redoCuePhrases, layoutCuePhrases };
  if (kb && typeof kb === 'object') kbCache.set(kb, helpers);
  return helpers;
}

function normalizeTabInfo(kb, tab) {
  const tabObj = kb?.tabs?.[tab] ?? {};
  const keys = new Map();
  for (const [k, spec] of mapEntries(tabObj.keys)) {
    const family = spec?.family ?? (k.includes('.') ? k.split('.')[0] : '');
    const head = spec?.head ?? 'span';
    const values = spec?.values ? new Set([...toArray(spec.values)].map((v) => String(v).toLowerCase())) : null;
    keys.set(k, { name: k, family, head, values });
  }

  const families = new Set(toArray(tabObj.families));
  for (const spec of keys.values()) {
    if (spec.family) families.add(spec.family);
  }

  return {
    tabObj,
    keys,
    families: [...families],
    familyWords: tabObj.familyWords ?? null,
    keyWordIndex: tabObj.keyWordIndex ?? null,
    closedValueIndex: tabObj.closedValueIndex ?? null,
    sorts: tabObj.sorts ?? null,
  };
}

// ---------------------------------------------------------------------------
// Static English closed lexical tables (grammar/syntactic cues only)
// ---------------------------------------------------------------------------

const DET_MAP = new Map([
  ['the', 'definite'],
  ['a', 'indefinite'],
  ['an', 'indefinite'],
  ['another', 'indefinite'],
  ['this', 'demonstrative'],
  ['that', 'demonstrative'],
  ['these', 'demonstrative'],
  ['those', 'demonstrative'],
  ['my', 'possessive'],
  ['your', 'possessive'],
  ['ur', 'possessive'],
  ['his', 'possessive'],
  ['her', 'possessive'],
  ['its', 'possessive'],
  ['our', 'possessive'],
  ['their', 'possessive'],
  ['all', 'quantified'],
  ['every', 'quantified'],
  ['each', 'quantified'],
  ['both', 'quantified'],
  ['some', 'quantified'],
  ['any', 'quantified'],
  ['many', 'quantified'],
  ['few', 'quantified'],
  ['several', 'quantified'],
]);

const ORDINAL_MAP = new Map([
  ['first', 'first'], ['1st', 'first'],
  ['second', 'second'], ['2nd', 'second'],
  ['third', 'third'], ['3rd', 'third'],
  ['fourth', 'fourth'], ['4th', 'fourth'],
  ['fifth', 'fifth'], ['5th', 'fifth'],
  ['last', 'last'],
  ['second last', 'second_last'], ['second-last', 'second_last'],
  ['newest', 'newest'], ['latest', 'newest'],
  ['oldest', 'oldest'],
  ['leftmost', 'leftmost'], ['rightmost', 'rightmost'],
  ['topmost', 'topmost'], ['bottommost', 'bottommost'],
]);

const QUANTIFIER_MAP = new Map([
  ['all', 'all'],
  ['every', 'every'],
  ['each', 'each'],
  ['both', 'both'],
  ['some', 'some'],
  ['many', 'many'],
  ['few', 'few'],
  ['a few', 'few'],
  ['several', 'several'],
  ['a couple', 'couple'],
  ['a couple of', 'couple'],
]);

const PRONOUN_REFS = new Map([
  ['it', 'definite'],
  ['them', 'definite'],
  ['one', 'definite'],
  ['this', 'demonstrative'],
  ['that', 'demonstrative'],
  ['these', 'demonstrative'],
  ['those', 'demonstrative'],
  ['this one', 'demonstrative'],
  ['that one', 'demonstrative'],
]);

const UNIVERSAL_REFS = new Set([
  'all',
  'everything',
  'all of them',
  'every one',
  'everyone',
  'both',
  'both of them',
]);

const JOURNAL_STEP_PHRASES = new Set([
  'last change',
  'previous change',
  'last step',
  'previous step',
  'last drawing change',
  'last edit',
  'previous edit',
  'previous action',
  'last action',
  'the last change',
  'the last step',
  'the previous change',
  'the previous step',
]);

const NEG_NOT_ALL = new Set([
  'not all',
  'not only',
  'not every',
  'not just',
  'not everything',
  'not all of them',
]);

const NEG_NO = new Set([
  'not',
  'no',
  'without',
  'never',
  "don't",
  'dont',
  'do not',
  "doesn't",
  'doesnt',
  "didn't",
  'didnt',
  "isn't",
  'isnt',
  "aren't",
  'arent',
  "won't",
  'wont',
  "can't",
  'cant',
  'cannot',
  'instead of',
  'rather than',
  'except',
  'except for',
  'other than',
  'with no',
  'but no',
  'minus',
]);

const NAME_INTRO_WORDS = new Set(['called', 'named', 'labelled', 'labeled', 'titled']);

const KEEPING_VERBS = new Set([
  'keep',
  'leave',
  'stay',
  'spare',
  'remain',
  'let',
]);

const QUESTION_PHRASES = new Map([
  ['what is', { mood: 'ask', question: 'what', cost: 2 }],
  ['what are', { mood: 'ask', question: 'what', cost: 2 }],
  ["what's", { mood: 'ask', question: 'what', cost: 2 }],
  ['how many', { mood: 'ask', question: 'count', cost: 2 }],
  ['how much', { mood: 'ask', question: 'how_much', cost: 2 }],
  ['is there', { mood: 'check', question: 'exists', cost: 2 }],
  ['are there', { mood: 'check', question: 'exists', cost: 2 }],
  ['where is', { mood: 'ask', question: 'where', cost: 2 }],
  ['where are', { mood: 'ask', question: 'where', cost: 2 }],
  ["where's", { mood: 'ask', question: 'where', cost: 2 }],
  ['when is', { mood: 'ask', question: 'when', cost: 2 }],
  ['when are', { mood: 'ask', question: 'when', cost: 2 }],
  ["when's", { mood: 'ask', question: 'when', cost: 2 }],
  ['who is', { mood: 'ask', question: 'who', cost: 2 }],
  ['who are', { mood: 'ask', question: 'who', cost: 2 }],
  ["who's", { mood: 'ask', question: 'who', cost: 2 }],
  ['which is', { mood: 'ask', question: 'which', cost: 2 }],
  ['which are', { mood: 'ask', question: 'which', cost: 2 }],
  ['tell me', { mood: 'ask', question: 'describe', cost: 2 }],
  ['what', { mood: 'ask', question: 'what', cost: 3 }],
  ['which', { mood: 'ask', question: 'which', cost: 3 }],
  ['where', { mood: 'ask', question: 'where', cost: 3 }],
  ['when', { mood: 'ask', question: 'when', cost: 3 }],
  ['who', { mood: 'ask', question: 'who', cost: 3 }],
  ['why', { mood: 'ask', question: 'why', cost: 3 }],
  ['how', { mood: 'ask', question: 'how', cost: 3 }],
  ['list', { mood: 'ask', question: 'list', cost: 1 }],
  ['count', { mood: 'ask', question: 'count', cost: 1 }],
  ['describe', { mood: 'ask', question: 'describe', cost: 1 }],
  ['explain', { mood: 'ask', question: 'describe', cost: 1 }],
  ['compare', { mood: 'ask', question: 'compare', cost: 1 }],
  ['total', { mood: 'ask', question: 'total', cost: 2 }],
  ['average', { mood: 'ask', question: 'average', cost: 2 }],
  ['max', { mood: 'ask', question: 'max', cost: 2 }],
  ['min', { mood: 'ask', question: 'min', cost: 2 }],
  ['difference', { mood: 'ask', question: 'difference', cost: 2 }],
  ['percent', { mood: 'ask', question: 'percent', cost: 2 }],
]);

const COPULA_QUESTION_WORDS = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did']);
const SOFT_CHANGE_PREDS = new Set(['should be', 'be', 'want', 'need', 'would like']);
const PLACE_OR_MAKE_VERBS = new Set(['place', 'put', 'stack', 'stick', 'drop', 'position', 'lay']);
const PASSIVE_MODAL_PHRASES = new Set(['needs to be', 'need to be', 'has to be', 'have to be', 'must be', 'should be', 'ought to be', 'to be']);
const NOUN_PRECEDING_WORDS = new Set(['the', 'a', 'an', 'this', 'that', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'per', 'by', 'of', 'in', 'on', 'for', 'from', 'to', 'with', 'without', 'each', 'every', 'first', 'second', 'third', 'last', 'new', 'old', 'next', 'previous']);
const CHART_AGG_WORDS = new Map([
  ['counting', 'count'], ['count', 'count'], ['counts', 'count'], ['number of', 'count'],
  ['sum', 'sum'], ['sum of', 'sum'], ['summing', 'sum'], ['total', 'sum'], ['total of', 'sum'],
  ['average', 'avg'], ['avg', 'avg'], ['mean', 'avg'], ['averaging', 'avg'],
  ['minimum', 'min'], ['min', 'min'], ['lowest', 'min'],
  ['maximum', 'max'], ['max', 'max'], ['highest', 'max'],
  ['median', 'median'],
]);

const COLOUR_SHADES = new Set(['dark', 'light', 'bright', 'pale', 'deep', 'pastel', 'vivid', 'soft', 'sky', 'navy']);

const DEGREE_ADVERBS = new Map([
  ['a bit', 'mild'],
  ['a little', 'mild'],
  ['slightly', 'mild'],
  ['somewhat', 'mild'],
  ['a touch', 'mild'],
  ['much', 'strong'],
  ['a lot', 'strong'],
  ['way', 'strong'],
  ['far', 'strong'],
  ['significantly', 'strong'],
  ['much more', 'strong'],
  ['even', 'mild'],
]);

const COMPARATIVE_SPECS = new Map([
  ['bigger', { dir: 'more', targets: ['size', 'scale', 'markerSize', 'fontSize'] }],
  ['larger', { dir: 'more', targets: ['size', 'scale', 'markerSize', 'fontSize'] }],
  ['smaller', { dir: 'less', targets: ['size', 'scale', 'markerSize', 'pieRadius', 'fontSize'] }],
  ['tinier', { dir: 'less', targets: ['size', 'scale', 'markerSize', 'fontSize'] }],
  ['wider', { dir: 'more', targets: ['width', 'barWidth', 'lineWidth', 'colourBarWidth', 'gridWidth', 'barEdgeWidth', 'errorCap'] }],
  ['narrower', { dir: 'less', targets: ['width', 'barWidth', 'lineWidth', 'colourBarWidth', 'gridWidth', 'barEdgeWidth', 'barGap'] }],
  ['taller', { dir: 'more', targets: ['height', 'barHeight', 'length', 'colourBarLength'] }],
  ['shorter', { dir: 'less', targets: ['height', 'barHeight', 'length', 'colourBarLength'] }],
  ['longer', { dir: 'more', targets: ['length', 'duration', 'colourBarLength'] }],
  ['thicker', { dir: 'more', targets: ['stroke', 'lineWidth', 'barEdgeWidth', 'colourBarWidth', 'gridWidth', 'width'] }],
  ['thinner', { dir: 'less', targets: ['stroke', 'lineWidth', 'barEdgeWidth', 'colourBarWidth', 'gridWidth', 'width'] }],
  ['darker', { dir: 'less', targets: ['colour', 'color'] }],
  ['lighter', { dir: 'more', targets: ['colour', 'color'] }],
  ['brighter', { dir: 'more', targets: ['colour', 'color'] }],
  ['fainter', { dir: 'less', targets: ['opacity'] }],
  ['clearer', { dir: 'more', targets: ['opacity'] }],
  ['later', { dir: 'more', targets: ['time', 'shift'] }],
  ['earlier', { dir: 'less', targets: ['time', 'shift'] }],
]);

const SCALE_DEGREE_MAP = new Map([
  ['tiny', 'tiny'],
  ['minuscule', 'tiny'],
  ['teeny', 'tiny'],
  ['very small', 'tiny'],
  ['small', 'small'],
  ['little', 'small'],
  ['mini', 'small'],
  ['medium', 'medium'],
  ['default', 'default'],
  ['normal', 'default'],
  ['big', 'big'],
  ['large', 'big'],
  ['huge', 'huge'],
  ['enormous', 'huge'],
  ['giant', 'huge'],
  ['gigantic', 'huge'],
  ['massive', 'huge'],
  ['very big', 'huge'],
  ['very large', 'huge'],
]);

const SPATIAL_RELATIONS = new Map([
  ['in', 'in'],
  ['inside', 'inside'],
  ['within', 'in'],
  ['into', 'in'],
  ['on', 'on'],
  ['onto', 'on'],
  ['on top of', 'above'],
  ['above', 'above'],
  ['over', 'above'],
  ['below', 'below'],
  ['under', 'under'],
  ['underneath', 'under'],
  ['beneath', 'below'],
  ['next to', 'next_to'],
  ['beside', 'next_to'],
  ['near', 'near'],
  ['close to', 'near'],
  ['by', 'near'],
  ['behind', 'behind'],
  ['in front of', 'in_front_of'],
  ['to the left of', 'left_of'],
  ['on the left side of', 'left_of'],
  ['left side of', 'left_of'],
  ['left of', 'left_of'],
  ['to the right of', 'right_of'],
  ['on the right side of', 'right_of'],
  ['right side of', 'right_of'],
  ['right of', 'right_of'],
  ['between', 'between'],
  ['outside', 'outside'],
  ['around', 'around'],
  ['along', 'along'],
  ['across', 'across'],
]);

const TEMPORAL_RELATIONS = new Map([
  ['before', 'before'],
  ['ahead of', 'before'],
  ['earlier than', 'before'],
  ['after', 'after'],
  ['behind', 'after'],
  ['later than', 'after'],
  ['during', 'during'],
  ['between', 'between'],
]);

const UNIT_CANON = new Map([
  ['minute', 'minute'], ['minutes', 'minute'], ['min', 'minute'], ['mins', 'minute'],
  ['hour', 'hour'], ['hours', 'hour'], ['hr', 'hour'], ['hrs', 'hour'],
  ['second', 'second'], ['seconds', 'second'], ['sec', 'second'], ['secs', 'second'],
  ['pixel', 'pixel'], ['pixels', 'pixel'], ['px', 'pixel'],
  ['degree', 'degree'], ['degrees', 'degree'], ['deg', 'degree'],
  ['percent', 'percent'], ['%', 'percent'],
  ['word', 'word'], ['words', 'word'],
  ['sentence', 'sentence'], ['sentences', 'sentence'],
  ['paragraph', 'paragraph'], ['paragraphs', 'paragraph'],
  ['chapter', 'chapter'], ['chapters', 'chapter'],
  ['page', 'page'], ['pages', 'page'],
  ['inch', 'inch'], ['inches', 'inch'],
  ['cm', 'cm'], ['mm', 'mm'],
  ['bin', 'bin'], ['bins', 'bin'],
  ['level', 'level'], ['levels', 'level'],
  ['row', 'row'], ['rows', 'row'],
  ['column', 'column'], ['columns', 'column'],
  ['seat', 'seat'], ['seats', 'seat'],
  ['decimal', 'decimal'], ['decimals', 'decimal'],
]);

const WEEKDAYS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const RELATIVE_DAYS = new Set(['today', 'tomorrow', 'yesterday', 'tonight']);
const DAY_MODIFIERS = new Set(['this', 'next', 'last']);
const TIME_OF_DAY_PHRASES = new Map([
  ['in the morning', 'morning'],
  ['this morning', 'morning'],
  ['morning', 'morning'],
  ['in the afternoon', 'afternoon'],
  ['this afternoon', 'afternoon'],
  ['afternoon', 'afternoon'],
  ['in the evening', 'evening'],
  ['this evening', 'evening'],
  ['evening', 'evening'],
  ['at night', 'night'],
  ['tonight', 'night'],
  ['at noon', 'noon'],
  ['noon', 'noon'],
  ['midnight', 'midnight'],
]);

const CHART_TYPE_PHRASES = new Map([
  ['bar chart', 'bar'], ['bar graph', 'bar'],
  ['line chart', 'line'], ['line graph', 'line'],
  ['pie chart', 'pie'], ['pie graph', 'pie'],
  ['doughnut chart', 'doughnut'], ['donut chart', 'doughnut'], ['doughnut', 'doughnut'], ['donut', 'doughnut'],
  ['scatter plot', 'scatter'], ['scatter chart', 'scatter'], ['scatter graph', 'scatter'],
  ['area chart', 'area'], ['area graph', 'area'],
  ['radar chart', 'radar'], ['radar graph', 'radar'],
  ['polar area chart', 'polarArea'], ['polar chart', 'polarArea'],
  ['histogram', 'bar'],
]);

const DIAGRAM_KIND_PHRASES = new Map([
  ['flowchart', 'flowchart'], ['flow chart', 'flowchart'],
  ['mind map', 'mind_map'], ['mindmap', 'mind_map'],
  ['org chart', 'org_chart'], ['organisation chart', 'org_chart'], ['organization chart', 'org_chart'],
  ['state machine', 'state_machine'],
  ['sequence diagram', 'sequence'],
  ['venn diagram', 'venn'], ['venn', 'venn'],
  ['timeline', 'timeline'],
  ['tree', 'tree'],
  ['network', 'network'],
  ['table', 'table'],
  ['bar chart', 'bar_chart'],
  ['line chart', 'line_chart'],
  ['pie chart', 'pie_chart'],
  ['doughnut chart', 'doughnut_chart'],
  ['scatter chart', 'scatter_chart'],
  ['radar chart', 'radar_chart'],
  ['area chart', 'area_chart'],
]);

const HOW_QUESTION_KEYS = new Map([
  ['tall', ['height']],
  ['high', ['height']],
  ['wide', ['width']],
  ['broad', ['width']],
  ['long', ['length', 'duration']],
  ['big', ['size']],
  ['large', ['size']],
  ['small', ['size']],
  ['old', ['age']],
  ['far', ['distance']],
  ['many', ['count', 'words', 'chapters', 'rows', 'columns']],
  ['much', ['opacity', 'distance', 'scale']],
  ['thick', ['stroke', 'lineWidth', 'width']],
]);

// ---------------------------------------------------------------------------
// Candidate Builders
// ---------------------------------------------------------------------------

function normalizeVerbEntries(raw, verbText) {
  const out = [];
  for (const e of toArray(raw)) {
    if (!e) continue;
    if (typeof e === 'string') {
      out.push({ act: e, mode: 'none', mood: 'do', question: 'none' });
      continue;
    }
    const acts = e.acts ? toArray(e.acts) : e.act ? [e.act] : [];
    for (const act of acts) {
      out.push({
        act,
        mode: e.mode ?? 'none',
        mood: e.mood ?? 'do',
        question: e.question ?? 'none',
        attribute: e.attribute ?? null,
        value: e.value ?? null,
        keeping: KEEPING_VERBS.has(verbText) && act === 'remove',
      });
    }
  }
  return out;
}

function resolveAttrShortNames(tabKeys, shortNames) {
  const out = [];
  for (const [attr] of tabKeys) {
    const shortKey = attr.includes('.') ? attr.split('.').slice(1).join('.') : attr;
    if (shortNames.includes(shortKey)) out.push(attr);
  }
  return out;
}

function resolveIntrinsicConstraint(tabKeys, shortAttr, rawVal) {
  if (!shortAttr) return [];
  const lowerVal = rawVal ? String(rawVal).toLowerCase() : '';
  let operator = 'eq';
  let step = 'none';
  let value = rawVal ?? '';

  if (['larger', 'bigger', 'wider', 'longer', 'thicker', 'lighter', 'brighter', 'more'].includes(lowerVal)) {
    operator = 'delta';
    step = 'more';
    value = '';
  } else if (['smaller', 'narrower', 'shorter', 'thinner', 'darker', 'less'].includes(lowerVal)) {
    operator = 'delta';
    step = 'less';
    value = '';
  }

  const candidateShorts = [shortAttr];
  if (shortAttr === 'colour') candidateShorts.push('color');
  if (shortAttr === 'thickness') candidateShorts.push('stroke', 'lineWidth');
  if (shortAttr === 'orientation') candidateShorts.push('turn', 'rotation', 'invert');
  if (shortAttr === 'visible') candidateShorts.push('legend', 'grid', 'gridlines', 'mode', 'hidden');

  const attrs = resolveAttrShortNames(tabKeys, candidateShorts);
  return attrs.map((attribute) => ({
    attribute,
    value,
    operator,
    step,
    on: defaultOnFor(attribute, operator),
  }));
}

function spanTextLower(tokens, s, e) {
  return tokens
    .slice(s, e + 1)
    .map((t) => t.lower)
    .join(' ');
}

function hasPunctInSpan(tokens, s, e) {
  for (let i = s; i <= e; i++) {
    if (tokens[i].isPunct) return true;
  }
  return false;
}

function operatorForAttr(attr, value, tabKeys) {
  const shortKey = attr.includes('.') ? attr.split('.').slice(1).join('.') : attr;
  if (['relation', 'position', 'order'].includes(shortKey)) return 'relation';
  if (shortKey === 'at') return 'region';
  if ((shortKey === 'size' || shortKey === 'length') && SCALE_DEGREE_MAP.has(String(value).toLowerCase())) {
    return 'degree';
  }
  const spec = tabKeys.get(attr);
  if (spec && spec.head && spec.head.includes('step') && SCALE_DEGREE_MAP.has(String(value).toLowerCase())) {
    return 'degree';
  }
  return 'eq';
}

function phaseHintForAttr(attr) {
  const shortKey = attr.includes('.') ? attr.split('.').slice(1).join('.') : attr;
  if (['id', 'ids', 'anchor', 'relation_anchor', 'order_anchor', 'behind', 'seat', 'near'].includes(shortKey)) {
    return 'selector';
  }
  return 'result';
}

function isCommandVerbToken(tok, kb) {
  if (!tok || tok.kind !== 'word') return false;
  for (const lemma of tok.lemmas) {
    if (mapGet(kb?.verbs, lemma)) return true;
  }
  return false;
}

function isPureGrammarOrVerbSpan(tokens, s, e, kb) {
  let allGramOrVerb = true;
  for (let i = s; i <= e; i++) {
    const t = tokens[i];
    if (t.isPunct) return true;
    // Capitalized mid-sentence proper titles ("Planning", "Review", "Draft", "Approve") are names, not verbs!
    if (t.isProperCandidate) {
      allGramOrVerb = false;
      continue;
    }
    if (!t.isGrammar && !isCommandVerbToken(t, kb)) {
      allGramOrVerb = false;
    }
  }
  return allGramOrVerb;
}

/**
 * Build the unfiltered lexical hypothesis lattice for `text` in `tab`.
 *
 * @param {string} text
 * @param {{ tab: string, kb: object, previous?: string|null, clock?: object|null }} opts
 * @returns {{ text: string, tab: string, tokens: Array<object>, candidates: Array<object>, splitPoints: Array<object>, hasQuestionMark: boolean }}
 */
export function buildLattice(text, { tab = 'drawing', kb = null, previous = null, clock = null } = {}) {
  const src = String(text ?? '');
  const tokens = tokenize(src, kb);
  const T = tokens.length;
  const { separableIndex, fillerPhrases, numberWords, undoCuePhrases, redoCuePhrases, layoutCuePhrases } = getKbHelpers(kb);
  const {
    keys: tabKeys,
    families: tabFamilies,
    familyWords,
    keyWordIndex,
    closedValueIndex,
    sorts: tabSorts,
  } = normalizeTabInfo(kb, tab);

  const rawCandidates = [];
  const splitPoints = [];
  const splitSeen = new Set();

  const emit = (cand) => {
    const start = tokens[cand.startTok].start;
    const end = tokens[cand.endTok].end;
    rawCandidates.push({
      ...cand,
      start,
      end,
      text: src.slice(start, end),
    });
  };

  const emitConstraint = (attr, value, startTok, endTok, extra = {}) => {
    const spec = tabKeys.get(attr);
    if (!spec) return;
    const operator = extra.operator ?? operatorForAttr(attr, value, tabKeys);
    const on = extra.on ?? defaultOnFor(attr, operator);
    const phase = extra.phase ?? phaseHintForAttr(attr);
    const step = extra.step ?? 'none';
    const openValue =
      extra.openValue ??
      Boolean(
        spec.values &&
          value !== '' &&
          !spec.values.has(String(value).toLowerCase())
      );

    // Never hallucinate invalid open values on closed-list schema keys unless explicitly allowed
    // (prevents bogus cross-family parses like drawn.font=shadow, group.size="a lot", or node.kind=dot hijacking fam_r).
    if (openValue && spec.values && !extra.allowOpen) return;

    const rawCost = extra.cost ?? 4;
    const cost = openValue ? Math.max(rawCost, 35) : rawCost;

    emit({
      kind: HYP_KINDS.CONSTRAINT,
      startTok,
      endTok,
      family: spec.family,
      attribute: attr,
      value: String(value),
      values: extra.values ?? null,
      on,
      operator,
      phase,
      step,
      openValue,
      requiresKeyWord: Boolean(extra.requiresKeyWord),
      prefersKeyWord: Boolean(extra.prefersKeyWord),
      needsAnchor: Boolean(extra.needsAnchor),
      isAnchor: Boolean(extra.isAnchor),
      pairedConstraints: extra.pairedConstraints ?? null,
      measure: extra.measure ?? null,
      unit: extra.unit ?? null,
      measureWords: extra.measureWords ?? null,
      character: extra.character ?? null,
      cost,
    });
  };

  // Helper: check preceding determiner before `tokIdx` (looks 1..2 tokens back across a single adjective/noun modifier,
  // e.g. "a line chart", "a blue house", "the profit chart", "a striped fill")
  const checkDetBefore = (tokIdx) => {
    if (tokIdx <= 0) return { det: 'none', detTok: -1 };
    const prev = tokens[tokIdx - 1];
    if (prev.kind === 'word' && DET_MAP.has(prev.lower)) {
      return { det: DET_MAP.get(prev.lower), detTok: tokIdx - 1 };
    }
    if (
      tokIdx >= 2 &&
      prev.kind === 'word' &&
      !prev.isPunct &&
      !prev.isGrammar &&
      !isCommandVerbToken(prev, kb)
    ) {
      const prev2 = tokens[tokIdx - 2];
      if (prev2.kind === 'word' && DET_MAP.has(prev2.lower)) {
        return { det: DET_MAP.get(prev2.lower), detTok: tokIdx - 2 };
      }
    }
    return { det: 'none', detTok: -1 };
  };

  // Helper: parse numeric value of token
  const parseNumeric = (tok) => {
    if (!tok) return null;
    if (tok.kind === 'number') {
      const cleaned = tok.text.endsWith('%') ? tok.text.slice(0, -1) : tok.text;
      const n = Number(cleaned);
      return Number.isNaN(n) ? null : n;
    }
    if (tok.kind === 'word' && numberWords.has(tok.lower)) {
      return numberWords.get(tok.lower);
    }
    return null;
  };

  // Pre-collect key groups on this tab for fast emission
  const colourKeys = [];
  const nameLikeKeys = [];
  const numberKeys = [];
  const idKeys = [];
  const relationKeys = [];
  const anchorKeys = [];
  const spanKeys = [];

  for (const [attr, spec] of tabKeys) {
    const shortKey = attr.includes('.') ? attr.split('.').slice(1).join('.') : attr;
    if (
      ['colour', 'color', 'outline', 'gradient', 'background', 'titleColour', 'barEdgeColour', 'textColour', 'highlight_colour'].includes(shortKey)
    ) {
      colourKeys.push(attr);
    }
    if (['name', 'label', 'title'].includes(shortKey)) {
      nameLikeKeys.push(attr);
    }
    if (spec.head === 'number' || spec.head.includes('number')) {
      numberKeys.push(attr);
    }
    if (['id', 'ids', 'members', 'nodes'].includes(shortKey)) {
      idKeys.push(attr);
    }
    if (['relation', 'position', 'order'].includes(shortKey)) {
      relationKeys.push(attr);
    }
    if (['anchor', 'relation_anchor', 'order_anchor'].includes(shortKey)) {
      anchorKeys.push(attr);
    }
    if (['title', 'label', 'name', 'text', 'content', 'agenda', 'items', 'values'].includes(shortKey) || (spec.head.includes('span') && shortKey !== 'ids' && shortKey !== 'id')) {
      spanKeys.push(attr);
    }
  }

  // Coordinate-capable families on this tab
  const coordFamilies = [];
  for (const fam of tabFamilies) {
    if (tabKeys.has(`${fam}.x`) && tabKeys.has(`${fam}.y`)) {
      coordFamilies.push(fam);
    }
  }

  // -------------------------------------------------------------------------
  // 1. FILLER, 2. GRAMMAR, 3. SEP, 4. NEG
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    const tok = tokens[i];

    // 2. GRAMMAR (single tokens with isGrammar && !isProperCandidate)
    if (tok.isGrammar && !tok.isProperCandidate) {
      emit({
        kind: HYP_KINDS.GRAMMAR,
        startTok: i,
        endTok: i,
        cost: 0,
      });
    }

    // 1. FILLER (single token — including single-word fillerPhrases like "cheers", "perfect", "great")
    if (tok.isFiller || fillerPhrases.has(tok.lower)) {
      emit({
        kind: HYP_KINDS.FILLER,
        startTok: i,
        endTok: i,
        isPureFiller: tok.isFiller || tok.isGrammar,
        cost: tok.isFiller ? 4 : 6,
      });
    }

    // 1. FILLER (multi-word phrases up to 4 tokens)
    for (let len = 2; len <= 4 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (fillerPhrases.has(ph)) {
        const isPure = tokens.slice(i, e + 1).every((t) => t.isFiller || t.isGrammar || t.isPunct);
        emit({
          kind: HYP_KINDS.FILLER,
          startTok: i,
          endTok: e,
          isPureFiller: isPure,
          cost: 1,
        });
      }
      // Passive modal wrapper ("needs to be", "has to be", "should be") before a past-participle verb
      if (PASSIVE_MODAL_PHRASES.has(ph) && e + 1 < T && tokens[e + 1].kind === 'word' && isCommandVerbToken(tokens[e + 1], kb)) {
        emit({
          kind: HYP_KINDS.FILLER,
          startTok: i,
          endTok: e,
          isPureFiller: true,
          cost: 2,
        });
      }
    }

    // 3. SEP (punctuation & joiners)
    if (tok.isPunct && (tok.text === ',' || tok.text === ';' || tok.text === '.')) {
      const isStrong = tok.text === ';' || tok.text === '.';
      emit({
        kind: HYP_KINDS.SEP,
        startTok: i,
        endTok: i,
        canSplitClause: true,
        isStrongSplit: isStrong,
        cost: 0,
      });
      const spKey = `${i}:${i}`;
      if (!splitSeen.has(spKey)) {
        splitSeen.add(spKey);
        splitPoints.push({ startTok: i, endTok: i, start: tok.start, end: tok.end, text: tok.text, isStrong });
      }
    }

    if (tok.kind === 'word' && ['and', 'then', 'also', 'but', 'afterwards', 'next'].includes(tok.lower)) {
      const isStrong = ['then', 'afterwards', 'next'].includes(tok.lower);
      emit({
        kind: HYP_KINDS.SEP,
        startTok: i,
        endTok: i,
        canSplitClause: true,
        isStrongSplit: isStrong,
        cost: 0,
      });
      const spKey = `${i}:${i}`;
      if (!splitSeen.has(spKey)) {
        splitSeen.add(spKey);
        splitPoints.push({ startTok: i, endTok: i, start: tok.start, end: tok.end, text: tok.text, isStrong });
      }
    }

    if (i + 1 < T) {
      const two = `${tokens[i].lower} ${tokens[i + 1].lower}`;
      if (['and then', 'and also', 'and next', ', then', ', and', '; then', '; and'].includes(two)) {
        const isStrong = two.endsWith('then') || two.endsWith('next') || two.startsWith(';');
        emit({
          kind: HYP_KINDS.SEP,
          startTok: i,
          endTok: i + 1,
          canSplitClause: true,
          isStrongSplit: isStrong,
          cost: 0,
        });
        const spKey = `${i}:${i + 1}`;
        if (!splitSeen.has(spKey)) {
          splitSeen.add(spKey);
          splitPoints.push({
            startTok: i,
            endTok: i + 1,
            start: tokens[i].start,
            end: tokens[i + 1].end,
            text: src.slice(tokens[i].start, tokens[i + 1].end),
            isStrong,
          });
        }
      }
    }

    // 4. NEG (1..4 token phrases)
    for (let len = 1; len <= 4 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (NEG_NOT_ALL.has(ph)) {
        emit({
          kind: HYP_KINDS.NEG,
          startTok: i,
          endTok: e,
          negWant: 'not_all',
          cost: 2,
        });
      } else if (NEG_NO.has(ph)) {
        emit({
          kind: HYP_KINDS.NEG,
          startTok: i,
          endTok: e,
          negWant: 'no',
          cost: 2,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. PREDICATE
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    const tok = tokens[i];
    if (tok.kind !== 'word') continue;

    // 5a. Verbs from kb.verbs (1..3 tokens)
    for (let len = 1; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const rest = len > 1 ? ' ' + spanTextLower(tokens, i + 1, e) : '';
      const headCandidates = len === 1 ? tok.lemmas : [tok.lower, ...tok.lemmas];
      const licensed = [];
      const licensedSeen = new Set();
      const intrinsic = [];
      const intrinsicSeen = new Set();
      let isKeeping = false;

      const addLicensed = (entry) => {
        const key = `${entry.act}|${entry.mode}|${entry.mood}|${entry.question}|${entry.keeping ? 1 : 0}|${entry.particle ?? ''}`;
        if (!licensedSeen.has(key)) {
          licensedSeen.add(key);
          licensed.push({
            act: entry.act,
            mode: entry.mode || 'none',
            mood: entry.mood || 'do',
            question: entry.question || 'none',
            ...(entry.keeping ? { keeping: true } : {}),
            ...(entry.particle ? { particle: entry.particle } : {}),
          });
        }
        if (entry.keeping) isKeeping = true;
        if (entry.attribute || entry.value) {
          for (const ic of resolveIntrinsicConstraint(tabKeys, entry.attribute, entry.value)) {
            const icKey = `${ic.attribute}|${ic.value}|${ic.operator}|${ic.step}`;
            if (!intrinsicSeen.has(icKey)) {
              intrinsicSeen.add(icKey);
              intrinsic.push(ic);
            }
          }
        }
      };

      for (const h of headCandidates) {
        const probe = h + rest;
        const raw = mapGet(kb?.verbs, probe);
        if (raw) {
          for (const ent of normalizeVerbEntries(raw, probe)) {
            if (ent.act === 'ask' && ent.question === 'none' && QUESTION_PHRASES.has(probe)) {
              ent.question = QUESTION_PHRASES.get(probe).question;
            }
            addLicensed(ent);
          }
        }
      }

      // Separable phrasal verbs when len === 1: look ahead for particle within local clause
      if (len === 1) {
        for (const h of tok.lemmas) {
          const sepList = separableIndex.get(h);
          if (!sepList) continue;
          for (const sep of sepList) {
            const plen = sep.particles.length;
            for (let j = i + 1; j <= Math.min(T - plen, i + 7); j++) {
              if (tokens[j].isPunct && [';', '.', '?', '!'].includes(tokens[j].text)) break;
              if (hasPunctInSpan(tokens, j, j + plen - 1)) continue;
              const candPart = spanTextLower(tokens, j, j + plen - 1);
              if (candPart === sep.particles.join(' ')) {
                for (const ent of normalizeVerbEntries(sep.entries, sep.full)) {
                  addLicensed({ ...ent, particle: candPart });
                }
                break;
              }
            }
          }
        }
      }

      // Placement verbs ("place two cats on top of...", "put a tree...", "stack a boat...") also license act=make!
      if (len === 1 && tok.lemmas.some((l) => PLACE_OR_MAKE_VERBS.has(l))) {
        addLicensed({ act: 'make', mode: 'none', mood: 'do', question: 'none' });
      }

      // Keeping verb marker (even if not in mock kb.verbs)
      if (len === 1 && KEEPING_VERBS.has(tok.lower)) {
        addLicensed({ act: 'remove', mode: 'none', mood: 'do', question: 'none', keeping: true });
      }

      // Document verb intrinsic shortcuts when kb.verbs marks bold/italicize/underline or tab has them
      if (len === 1 && tab === 'document') {
        if (['bold', 'embolden'].includes(tok.lower)) {
          for (const attr of resolveAttrShortNames(tabKeys, ['mark', 'format'])) {
            intrinsic.push({ attribute: attr, value: 'bold', operator: 'eq', step: 'none', on: 'attribute' });
          }
        } else if (['italicize', 'italicise'].includes(tok.lower)) {
          for (const attr of resolveAttrShortNames(tabKeys, ['mark', 'format'])) {
            intrinsic.push({ attribute: attr, value: 'italic', operator: 'eq', step: 'none', on: 'attribute' });
          }
        } else if (tok.lower === 'underline') {
          for (const attr of resolveAttrShortNames(tabKeys, ['mark', 'format'])) {
            intrinsic.push({ attribute: attr, value: 'underline', operator: 'eq', step: 'none', on: 'attribute' });
          }
        }
      }

      if (licensed.length > 0) {
        // Pure speech acts ("thanks", "hello", "bye") stay as fillers, not action predicates.
        const actionLicensed = licensed.filter((l) => !['greet', 'thank', 'farewell'].includes(l.act));
        // Gerund/noun & attributive participle guard:
        // - "-ing" / nominalized word right after determiner/preposition ("the drawing", "a heading", "last edit")
        // - or 2 tokens after determiner/preposition across a modifier ("a striped fill", "the profit chart", "the Plan chapter")
        // - "-ed" attributive participle right after determiner followed by noun ("a paired view", "the dashed line")
        const prevWord = i > 0 && tokens[i - 1].kind === 'word' ? tokens[i - 1].lower : '';
        const prev2Word = i > 1 && tokens[i - 2].kind === 'word' && !tokens[i - 1].isPunct ? tokens[i - 2].lower : '';
        const NOMINAL_AMBIG = new Set(['edit', 'change', 'step', 'move', 'swap', 'copy', 'group', 'link', 'line', 'label', 'title', 'name', 'chart', 'plot', 'graph', 'table', 'list', 'text', 'note', 'block', 'section', 'meeting', 'event', 'room', 'place', 'spot', 'point', 'cut', 'fill', 'scale', 'order', 'sort', 'filter', 'frame', 'shadow', 'glow', 'outline', 'stroke', 'mirror', 'turn', 'bend', 'split', 'merge', 'stack', 'drop', 'mix', 'plan', 'role', 'gap', 'view', 'format', 'style', 'grid', 'row', 'column', 'level', 'mark', 'quote', 'review']);
        const detOrPrepBefore = NOUN_PRECEDING_WORDS.has(prevWord) || (NOUN_PRECEDING_WORDS.has(prev2Word) && !isCommandVerbToken(tokens[i - 1], kb));
        const isNominalizedAfterDetOrPrep = len === 1 && detOrPrepBefore
          && (tok.lower.endsWith('ing') || (tok.lower.endsWith('ed') && i + 1 < T && tokens[i + 1].kind === 'word') || NOMINAL_AMBIG.has(tok.lower));
        // Passive/embedded finite clause guard: "are distributed across...", "points joined fair"
        const isInflectedNonImperative = len === 1 && (
          (tok.lower.endsWith('s') && tok.lemmas.some((l) => l !== tok.lower && mapGet(kb?.verbs, l))) ||
          (tok.lower.endsWith('ed') && !['be', 'been', 'get'].includes(prevWord))
        );
        // A key-like verb ("name", "label", "title") sitting right after ';' or ',' inside a noun-headed spec (e.g. "; name Power")
        // pays higher predicate cost so KEY_WORD wins unless it starts the utterance!
        const isSpecKeyAfterSemi = len === 1 && i > 0 && (tokens[i - 1].text === ';' || tokens[i - 1].text === ',')
          && ['name', 'label', 'title', 'sort', 'order', 'group', 'scale'].includes(tok.lower);
        if (actionLicensed.length > 0 && !isNominalizedAfterDetOrPrep) {
          emit({
            kind: HYP_KINDS.PREDICATE,
            startTok: i,
            endTok: e,
            licensed: actionLicensed,
            isKeepingVerb: isKeeping,
            intrinsicConstraints: intrinsic,
            cost: isSpecKeyAfterSemi ? 10 : isInflectedNonImperative ? 14 : (len === 1 ? 2 : 1),
          });
        }
      }
    }

    // 5b. Question predicates (1..2 tokens)
    const prevQWord = i > 0 && tokens[i - 1].kind === 'word' ? tokens[i - 1].lower : '';
    const NOMINAL_Q_NOUNS = new Set(['list', 'count', 'total', 'average', 'max', 'min', 'difference', 'percent']);
    for (let len = 1; len <= 2 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (len === 1 && NOMINAL_Q_NOUNS.has(ph) && NOUN_PRECEDING_WORDS.has(prevQWord)) continue;
      if (QUESTION_PHRASES.has(ph)) {
        const qSpec = QUESTION_PHRASES.get(ph);
        // "which events / which meetings / which rooms / what items..." asks to LIST matching items!
        const nextTok = e + 1 < T ? tokens[e + 1] : null;
        const nextIsPluralNoun = nextTok && nextTok.kind === 'word' && !nextTok.isGrammar && nextTok.lower.endsWith('s') && nextTok.lower.length > 3;
        if ((ph === 'which' || ph === 'what') && nextIsPluralNoun) {
          emit({
            kind: HYP_KINDS.PREDICATE,
            startTok: i,
            endTok: e,
            licensed: [{ act: 'ask', mode: 'none', mood: 'ask', question: 'list' }],
            isKeepingVerb: false,
            intrinsicConstraints: [],
            cost: 1.5,
          });
        }
        emit({
          kind: HYP_KINDS.PREDICATE,
          startTok: i,
          endTok: e,
          licensed: [{ act: 'ask', mode: 'none', mood: qSpec.mood, question: qSpec.question }],
          isKeepingVerb: false,
          intrinsicConstraints: [],
          cost: qSpec.cost,
        });
      }
    }

    if (COPULA_QUESTION_WORDS.has(tok.lower)) {
      emit({
        kind: HYP_KINDS.PREDICATE,
        startTok: i,
        endTok: i,
        licensed: [
          { act: 'ask', mode: 'none', mood: 'check', question: 'exists' },
          { act: 'ask', mode: 'none', mood: 'ask', question: 'what' },
        ],
        isKeepingVerb: false,
        intrinsicConstraints: [],
        cost: 5,
      });
    }

    // 5c. Copula / desire predicates ("should be", "be", "want", "need", "would like")
    for (let len = 1; len <= 2 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (SOFT_CHANGE_PREDS.has(ph)) {
        const lic = [{ act: 'change', mode: 'none', mood: 'do', question: 'none' }];
        if (ph === 'want' || ph === 'need' || ph === 'would like') {
          lic.push({ act: 'make', mode: 'none', mood: 'do', question: 'none' });
        }
        emit({
          kind: HYP_KINDS.PREDICATE,
          startTok: i,
          endTok: e,
          licensed: lic,
          isKeepingVerb: false,
          intrinsicConstraints: [],
          cost: 6,
        });
      }
    }

    // 5d. Reaction undo/redo cues from w.lang.en.cue ("put it back", "edit back", "go back", "do it again", "start over")
    for (let len = 2; len <= 4 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (undoCuePhrases.has(ph)) {
        emit({
          kind: HYP_KINDS.PREDICATE,
          startTok: i,
          endTok: e,
          licensed: [{ act: 'undo', mode: 'none', mood: 'do', question: 'none' }],
          isKeepingVerb: false,
          intrinsicConstraints: [],
          cost: 1.5,
        });
      } else if (redoCuePhrases.has(ph)) {
        emit({
          kind: HYP_KINDS.PREDICATE,
          startTok: i,
          endTok: e,
          licensed: [
            { act: 'redo', mode: 'none', mood: 'do', question: 'none' },
            { act: 'copy', mode: 'repeat', mood: 'do', question: 'none' },
          ],
          isKeepingVerb: false,
          intrinsicConstraints: [],
          cost: 2,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. TARGET_FAMILY & 7. TARGET_SORT
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    for (let len = 1; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const rawPhrase = src.slice(tokens[i].start, tokens[e].end);
      const forms = singularisePhrase(spanTextLower(tokens, i, e), kb);

      // 6. TARGET_FAMILY
      const matchedFamilies = new Set();
      for (const f of forms) {
        const famVal = mapGet(familyWords, f);
        for (const fam of toArray(famVal)) {
          if (fam) matchedFamilies.add(String(fam));
        }
      }
      if (matchedFamilies.size > 0) {
        const { det, detTok } = checkDetBefore(i);
        for (const family of matchedFamilies) {
          emit({
            kind: HYP_KINDS.TARGET_FAMILY,
            startTok: i,
            endTok: e,
            family,
            familyWords: rawPhrase,
            det,
            detTok,
            count: null,
            countWords: null,
            ordinal: null,
            quantifier: null,
            quantity: null,
            cost: 3,
          });

          // Preceding count / ordinal / quantifier before TARGET_FAMILY (e.g. "first paragraph", "two charts")
          if (i >= 1) {
            const m1 = tokens[i - 1];
            const num1 = parseNumeric(m1);
            if (num1 !== null && Number.isInteger(num1) && num1 >= 0) {
              const outerDet = checkDetBefore(i - 1);
              emit({
                kind: HYP_KINDS.TARGET_FAMILY,
                startTok: i - 1,
                endTok: e,
                family,
                familyWords: rawPhrase,
                det: outerDet.det,
                detTok: outerDet.detTok,
                count: num1,
                countWords: m1.text,
                ordinal: null,
                quantifier: null,
                quantity: null,
                cost: 2.5,
              });
            } else if (ORDINAL_MAP.has(m1.lower)) {
              const outerDet = checkDetBefore(i - 1);
              emit({
                kind: HYP_KINDS.TARGET_FAMILY,
                startTok: i - 1,
                endTok: e,
                family,
                familyWords: rawPhrase,
                det: outerDet.det,
                detTok: outerDet.detTok,
                count: null,
                countWords: null,
                ordinal: ORDINAL_MAP.get(m1.lower),
                quantifier: null,
                quantity: null,
                cost: 2.5,
              });
            } else if (QUANTIFIER_MAP.has(m1.lower) && !m1.isGrammar) {
              const outerDet = checkDetBefore(i - 1);
              emit({
                kind: HYP_KINDS.TARGET_FAMILY,
                startTok: i - 1,
                endTok: e,
                family,
                familyWords: rawPhrase,
                det: outerDet.det !== 'none' ? outerDet.det : 'quantified',
                detTok: outerDet.detTok,
                count: null,
                countWords: null,
                ordinal: null,
                quantifier: m1.text,
                quantity: QUANTIFIER_MAP.get(m1.lower),
                cost: 2.5,
              });
            }
          }
        }
      }

      // 7. TARGET_SORT
      const sortMatches = []; // { sort, family }
      const sortSeen = new Set();
      const addSort = (sort, family) => {
        if (!sort || !family) return;
        const k = `${family}|${sort}`;
        if (!sortSeen.has(k)) {
          sortSeen.add(k);
          sortMatches.push({ sort: String(sort), family: String(family) });
        }
      };

      // Prefer singularized forms first so plural nouns ("clouds") canonically emit sort=cloud sort_words=clouds
      const singularFirst = forms.length > 1 ? [...forms.slice(1), forms[0]] : forms;
      for (const f of singularFirst) {
        // Explicit tab sorts map if provided by kb
        const explicitSort = mapGet(tabSorts, f);
        if (explicitSort) {
          for (const ent of toArray(explicitSort)) {
            if (typeof ent === 'string') addSort(ent, tabFamilies[0] ?? 'drawn');
            else if (ent && ent.sort) addSort(ent.sort, ent.family ?? tabFamilies[0]);
          }
        }

        if (tab === 'drawing') {
          const bp = vocabMatch(kb?.domain?.bodyParts, f);
          if (bp) addSort(bp, 'part');
          const obj = vocabMatch(kb?.domain?.objects, f);
          if (obj) addSort(obj, 'drawn');
          const ppl = vocabMatch(kb?.domain?.people, f);
          if (ppl) addSort(ppl, 'drawn');
          const ani = vocabMatch(kb?.domain?.animals, f);
          if (ani) addSort(ani, 'drawn');
          const shp = vocabMatch(kb?.domain?.shapes, f);
          if (shp) addSort(shp, 'drawn');
        } else if (tab === 'diagram') {
          const shp = vocabMatch(kb?.domain?.shapes, f);
          if (shp) addSort(shp, 'node');
          const diag = vocabMatch(kb?.domain?.diagrams, f);
          if (diag) addSort(diag, 'diagram');
          const ch = vocabMatch(kb?.domain?.charts, f);
          if (ch) addSort(ch, 'chart');
        } else if (tab === 'document') {
          const gen = vocabMatch(kb?.domain?.genres, f);
          if (gen) {
            if (tabFamilies.includes('text')) addSort(gen, 'text');
            if (tabFamilies.includes('document')) addSort(gen, 'document');
          }
        }
        // Once singular matched a sort for this span, stop so plural duplicate ("clouds") isn't emitted alongside "cloud"
        if (sortMatches.length > 0 && f !== forms[0]) break;
      }

      for (const { sort, family } of sortMatches) {
        const sortWords = rawPhrase.toLowerCase() !== sort.toLowerCase() ? rawPhrase : null;
        const { det, detTok } = checkDetBefore(i);
        // When a drawing noun is ALSO a declared body/face part, keep both hypotheses
        // but give `part` a clean prior advantage over standalone `drawn` object (e.g., "shift the nose up").
        const isAlsoBodyPart = tab === 'drawing' && family === 'drawn' && sortMatches.some((x) => x.family === 'part');
        const baseSortCost = isAlsoBodyPart ? 14 : (family === 'part' ? 3 : 5);
        emit({
          kind: HYP_KINDS.TARGET_SORT,
          startTok: i,
          endTok: e,
          family,
          sort,
          sortWords,
          det,
          detTok,
          count: null,
          countWords: null,
          ordinal: null,
          quantifier: null,
          quantity: null,
          cost: baseSortCost,
        });

        // Also check immediate preceding modifier (count / ordinal / quantifier)
        if (i >= 1) {
          const m1 = tokens[i - 1];
          const num1 = parseNumeric(m1);
          if (num1 !== null && Number.isInteger(num1) && num1 >= 0) {
            const outerDet = checkDetBefore(i - 1);
            emit({
              kind: HYP_KINDS.TARGET_SORT,
              startTok: i - 1,
              endTok: e,
              family,
              sort,
              sortWords,
              det: outerDet.det,
              detTok: outerDet.detTok,
              count: num1,
              countWords: m1.text,
              ordinal: null,
              quantifier: null,
              quantity: null,
              cost: 1.5,
            });
          } else if (ORDINAL_MAP.has(m1.lower)) {
            const outerDet = checkDetBefore(i - 1);
            emit({
              kind: HYP_KINDS.TARGET_SORT,
              startTok: i - 1,
              endTok: e,
              family,
              sort,
              sortWords,
              det: outerDet.det,
              detTok: outerDet.detTok,
              count: null,
              countWords: null,
              ordinal: ORDINAL_MAP.get(m1.lower),
              quantifier: null,
              quantity: null,
              cost: 1.5,
            });
          } else if (QUANTIFIER_MAP.has(m1.lower) && !m1.isGrammar) {
            const outerDet = checkDetBefore(i - 1);
            emit({
              kind: HYP_KINDS.TARGET_SORT,
              startTok: i - 1,
              endTok: e,
              family,
              sort,
              sortWords,
              det: outerDet.det !== 'none' ? outerDet.det : 'quantified',
              detTok: outerDet.detTok,
              count: null,
              countWords: null,
              ordinal: null,
              quantifier: m1.text,
              quantity: QUANTIFIER_MAP.get(m1.lower),
              cost: 1.5,
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. TARGET_REF (pronouns, universal, journal_step, codes, proper names, quotes)
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    const tok = tokens[i];

    // Pronouns (1..2 tokens)
    for (let len = 1; len <= 2 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (PRONOUN_REFS.has(ph)) {
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: e,
          fill: 'context',
          isPronoun: true,
          det: PRONOUN_REFS.get(ph),
          families: tabFamilies,
          cost: 3,
        });
      }
      if (UNIVERSAL_REFS.has(ph)) {
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: e,
          fill: 'all',
          quantifier: src.slice(tokens[i].start, tokens[e].end),
          det: 'quantified',
          families: tabFamilies,
          cost: 3,
        });
      }
    }

    // Universal 3-token ("all of them", "both of them") & journal steps (2..4 tokens)
    for (let len = 2; len <= 4 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (UNIVERSAL_REFS.has(ph)) {
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: e,
          fill: 'all',
          quantifier: src.slice(tokens[i].start, tokens[e].end),
          det: 'quantified',
          families: tabFamilies,
          cost: 3,
        });
      }
      if (JOURNAL_STEP_PHRASES.has(ph)) {
        const { det, detTok } = checkDetBefore(i);
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: e,
          fill: 'journal_step',
          description: src.slice(tokens[i].start, tokens[e].end),
          det: det !== 'none' ? det : 'definite',
          detTok,
          families: tabFamilies,
          cost: 2,
        });
      }
    }

    // Code tokens (n1, o2, b2, g1, c1, a1, e2, s1, p1...)
    if (tok.kind === 'code') {
      const { det, detTok } = checkDetBefore(i);
      emit({
        kind: HYP_KINDS.TARGET_REF,
        startTok: i,
        endTok: i,
        fill: 'written',
        name: tok.text,
        ids: [tok.text],
        codeWords: tok.text,
        isCode: true,
        det,
        detTok,
        families: tabFamilies,
        cost: 2,
      });

      for (const attr of idKeys) {
        emitConstraint(attr, tok.text, i, i, { phase: 'selector', cost: 2.5 });
      }

      // Coordinated codes: "o1 and o2", "o1, o2 and o3"
      if (i + 2 < T && tokens[i + 1].lower === 'and' && tokens[i + 2].kind === 'code') {
        const ids = [tok.text, tokens[i + 2].text];
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: i + 2,
          fill: 'written',
          ids,
          codeWords: src.slice(tok.start, tokens[i + 2].end),
          isCode: true,
          det,
          detTok,
          families: tabFamilies,
          cost: 1.5,
        });
        for (const attr of idKeys) {
          if (attr.endsWith('.ids') || attr.endsWith('.members') || attr.endsWith('.nodes')) {
            emitConstraint(attr, ids.join(', '), i, i + 2, {
              values: ids,
              phase: 'selector',
              cost: 2,
            });
          }
        }
      }
      if (
        i + 4 < T &&
        tokens[i + 1].text === ',' &&
        tokens[i + 2].kind === 'code' &&
        tokens[i + 3].lower === 'and' &&
        tokens[i + 4].kind === 'code'
      ) {
        const ids = [tok.text, tokens[i + 2].text, tokens[i + 4].text];
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: i + 4,
          fill: 'written',
          ids,
          codeWords: src.slice(tok.start, tokens[i + 4].end),
          isCode: true,
          det,
          detTok,
          families: tabFamilies,
          cost: 1.2,
        });
        for (const attr of idKeys) {
          if (attr.endsWith('.ids') || attr.endsWith('.members') || attr.endsWith('.nodes')) {
            emitConstraint(attr, ids.join(', '), i, i + 4, {
              values: ids,
              phase: 'selector',
              cost: 1.8,
            });
          }
        }
      }
    }

    // Capitalized proper names (mid-sentence, or sentence-start non-verb/non-grammar)
    // Also supports English title/sentence-case multi-word names like "Monthly goals", "Terms of service",
    // "Quote request", "Bin collection update", "Weekly shop", "Team review", "Work 4"!
    const canStartProper =
      tok.isProperCandidate ||
      (tok.kind === 'word' &&
        tok.isCapitalized &&
        tok.isSentenceStart &&
        !tok.isGrammar &&
        !tok.isFiller &&
        !isCommandVerbToken(tok, kb) &&
        !/^[A-Z]{2,}s?$/.test(tok.text));

    if (canStartProper && !tok.isTimezone) {
      const { det, detTok } = checkDetBefore(i);
      const prevIsObliquePrep = i > 0 && tokens[i - 1].kind === 'word'
        && ['on', 'in', 'at', 'to', 'from', 'with', 'for', 'by', 'into', 'onto', 'of'].includes(tokens[i - 1].lower);
      // 1..3 consecutive proper/sentence-case title tokens (or [Proper, number] like "Work 6")
      for (let len = 1; len <= 3 && i + len <= T; len++) {
        const e = i + len - 1;
        if (hasPunctInSpan(tokens, i, e)) break;
        const lastTok = tokens[e];
        const isLowerTitleWord =
          lastTok.kind === 'word' &&
          !lastTok.isGrammar &&
          !lastTok.isFiller &&
          !['containing', 'saying', 'called', 'named', 'titled', 'labelled', 'labeled', 'approximately', 'roughly', 'around', 'ahead', 'behind'].includes(lastTok.lower) &&
          !vocabMatch(kb?.domain?.colours, lastTok.lower) &&
          !SCALE_DEGREE_MAP.has(lastTok.lower) &&
          !COMPARATIVE_SPECS.has(lastTok.lower) &&
          !SPATIAL_RELATIONS.has(lastTok.lower) &&
          !TEMPORAL_RELATIONS.has(lastTok.lower) &&
          !mapGet(familyWords, lastTok.lower) &&
          (!isCommandVerbToken(lastTok, kb) || ['update', 'request', 'shop', 'review', 'plan', 'report', 'service', 'track', 'draft', 'appeal'].includes(lastTok.lower));
        const isMidOf = len === 2 && lastTok.lower === 'of' && i + 2 < T && tokens[i + 2].kind === 'word';
        const validTail =
          len === 1 ||
          lastTok.isProperCandidate ||
          isLowerTitleWord ||
          isMidOf ||
          (len === 2 && lastTok.kind === 'number' && !lastTok.text.includes('%'));
        if (!validTail) break;
        if (isMidOf) continue; // don't emit dangling "Terms of", keep going to "Terms of service"
        const nameText = src.slice(tokens[i].start, tokens[e].end);
        const basePropCost = (tok.isSentenceStart ? 6 : 4) + (prevIsObliquePrep ? 15 : 0) + (len > 1 ? 1 : 0);
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: i,
          endTok: e,
          fill: 'written',
          name: nameText,
          isProper: true,
          det,
          detTok,
          families: tabFamilies,
          cost: basePropCost,
        });
        for (const attr of idKeys) {
          if (attr.endsWith('.id')) {
            emitConstraint(attr, nameText, i, e, { phase: 'selector', cost: basePropCost + 2 });
          }
        }
      }
    }

    // Quoted names ("Start", "Review", "nose")
    if (tok.kind === 'quote' && tok.inner) {
      const { det, detTok } = checkDetBefore(i);
      emit({
        kind: HYP_KINDS.TARGET_REF,
        startTok: i,
        endTok: i,
        fill: 'written',
        name: tok.inner,
        nameWords: tok.text,
        isQuoted: true,
        isProper: true,
        det,
        detTok,
        families: tabFamilies,
        cost: 4,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. KEY_WORD
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    for (let len = 1; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const forms = singularisePhrase(spanTextLower(tokens, i, e), kb);
      const attrs = new Set();
      const fams = new Set();

      for (const f of forms) {
        const hits = mapGet(keyWordIndex, f);
        for (const h of toArray(hits)) {
          if (typeof h === 'string') {
            if (tabKeys.has(h)) {
              // Avoid generic verb "place" falsely triggering catch-all page.scene
              if (f === 'place' && h === 'page.scene') continue;
              attrs.add(h);
              fams.add(tabKeys.get(h).family);
            }
          } else if (h && h.attr && tabKeys.has(h.attr)) {
            if (f === 'place' && h.attr === 'page.scene') continue;
            attrs.add(h.attr);
            fams.add(h.family ?? tabKeys.get(h.attr).family);
          }
        }
      }
      if (tab === 'diagram' && len === 1 && (tokens[i].lower === 'x' || tokens[i].lower === 'y')) {
        const axisKey = tokens[i].lower === 'x' ? 'chart.xAxis' : 'chart.axisSide';
        if (tabKeys.has(axisKey)) {
          attrs.add(axisKey);
          fams.add('chart');
        }
      }

      if (attrs.size > 0) {
        emit({
          kind: HYP_KINDS.KEY_WORD,
          startTok: i,
          endTok: e,
          attrs: [...attrs],
          families: [...fams],
          isNameIntro: false,
          cost: 2,
        });
      }
    }

    const tok = tokens[i];
    if (tok.kind === 'word' && (NAME_INTRO_WORDS.has(tok.lower) || (i > 0 && (tokens[i - 1].text === ';' || tokens[i - 1].text === ',') && ['name', 'title', 'label'].includes(tok.lower))) && nameLikeKeys.length > 0) {
      emit({
        kind: HYP_KINDS.KEY_WORD,
        startTok: i,
        endTok: i,
        attrs: [...nameLikeKeys],
        families: [...new Set(nameLikeKeys.map((a) => tabKeys.get(a).family))],
        isNameIntro: true,
        cost: 1,
      });
    }

    // Dimension adjective key_words right after a number/unit ("67 pixels wide", "100 tall", "200 long")
    const DIM_ADJ_KEYS = { wide: ['width', 'size'], tall: ['height', 'size'], high: ['height', 'size'], long: ['length', 'duration'], thick: ['stroke', 'lineWidth', 'width'] };
    if (tok.kind === 'word' && DIM_ADJ_KEYS[tok.lower] && i > 0) {
      const dimAttrs = resolveAttrShortNames(tabKeys, DIM_ADJ_KEYS[tok.lower]);
      const followsMeasure = tokens[i - 1].kind === 'number' || UNIT_CANON.has(tokens[i - 1].lower);
      if (dimAttrs.length > 0) {
        emit({
          kind: HYP_KINDS.KEY_WORD,
          startTok: i,
          endTok: i,
          attrs: dimAttrs,
          families: [...new Set(dimAttrs.map((a) => tabKeys.get(a).family))],
          isNameIntro: false,
          cost: followsMeasure ? 0.5 : 1.5,
        });
      }
    }

    // "how <adj>" / "what <key>" question cues
    if (i > 0 && tokens[i - 1].lower === 'how' && HOW_QUESTION_KEYS.has(tok.lower)) {
      const qAttrs = resolveAttrShortNames(tabKeys, HOW_QUESTION_KEYS.get(tok.lower));
      if (qAttrs.length > 0) {
        emit({
          kind: HYP_KINDS.KEY_WORD,
          startTok: i,
          endTok: i,
          attrs: qAttrs,
          families: [...new Set(qAttrs.map((a) => tabKeys.get(a).family))],
          isNameIntro: false,
          isQuestionCue: true,
          cost: 2,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 10. CONSTRAINT
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    const tok = tokens[i];

    // 10a. Closed-list values (1..4 tokens)
    for (let len = 1; len <= 4 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const lowerSpaced = spanTextLower(tokens, i, e);
      const dehyphen = lowerSpaced.replace(/-/g, ' ');
      const forms = [
        lowerSpaced,
        dehyphen,
        lowerSpaced.replace(/[\s-]+/g, '_'),
        ...singularisePhrase(lowerSpaced, kb),
        ...(dehyphen !== lowerSpaced ? singularisePhrase(dehyphen, kb) : []),
      ];
      const seenHits = new Set();
      for (const f of forms) {
        const hits = mapGet(closedValueIndex, f);
        for (const h of toArray(hits)) {
          if (!h || !h.attr || !tabKeys.has(h.attr)) continue;
          const hk = `${h.attr}|${h.value}`;
          if (seenHits.has(hk)) continue;
          seenHits.add(hk);
          // Give drawn.base/drawn.preset higher prior cost than TARGET_SORT unless bound by KEY_WORD (preset/kind),
          // and give capitalized proper-name tokens higher cost on lowercase closed-list homonyms (e.g. "Power" vs chart.tickFormat=power).
          // Generic boolean/toggle words ("show", "hide", "on", "off", "yes", "no", "true", "false", "none") MUST bind a KEY_WORD!
          const GENERIC_TOGGLE_VALS = new Set(['show', 'hide', 'on', 'off', 'yes', 'no', 'true', 'false', 'none']);
          const needsToggleKw = (len === 1 && GENERIC_TOGGLE_VALS.has(String(h.value).toLowerCase()))
            || h.attr === 'chart.gridAxis';
          let closedCost = len > 1 ? 2 : 4;
          if (h.attr === 'drawn.base' || h.attr === 'drawn.preset') closedCost = 9;
          else if (h.attr === 'drawn.at') closedCost = len > 1 ? 1.5 : 3;
          else if (h.attr === 'drawn.edge' || h.attr === 'drawn.side' || h.attr === 'drawn.facing') closedCost = 6.5;
          else if (h.attr === 'link.tail' || h.attr === 'link.head' || h.attr === 'part.value' || h.attr === 'part.variant' || h.attr === 'diagram.by') closedCost = 9;
          if (len === 1 && tokens[i].isProperCandidate && !['UTC', 'GMT'].includes(tokens[i].text)) closedCost += 8;
          emitConstraint(h.attr, h.value, i, e, {
            requiresKeyWord: needsToggleKw,
            cost: closedCost,
          });
        }
      }
    }

    // 10b. Colours (+ optional shade prefix like "dark blue", "light green")
    for (let len = 1; len <= 2 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const isShade =
        COLOUR_SHADES.has(tokens[i].lower) ||
        Boolean(vocabMatch(kb?.domain?.shades, tokens[i].lower));
      if (len === 2 && !isShade) continue;
      const tailColour = vocabMatch(kb?.domain?.colours, tokens[e].lower);
      if (tailColour) {
        const val = len === 2 ? `${tokens[i].lower} ${tailColour}` : tailColour;
        for (const attr of colourKeys) {
          const shortKey = attr.split('.').slice(1).join('.');
          // Secondary colour keys (titleColour, barEdgeColour, textColour, outline, gradient, highlight_colour)
          // require or strongly prefer their explicit KEY_WORD unless plain colour/color!
          const isPrimaryColour = shortKey === 'colour' || shortKey === 'color';
          emitConstraint(attr, val, i, e, {
            requiresKeyWord: !isPrimaryColour && ['titleColour', 'barEdgeColour', 'textColour', 'gradient', 'highlight_colour'].includes(shortKey),
            cost: isPrimaryColour ? (len === 2 ? 3 : 4) : 8,
          });
        }
      }
    }

    // 10c. Scales, Degrees & Comparatives (including degree adverb + comparative)
    // Scale degrees (1..2 tokens)
    for (let len = 1; len <= 2 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      const scaleHit = SCALE_DEGREE_MAP.get(ph) ?? vocabMatch(kb?.domain?.scales, ph);
      if (scaleHit) {
        for (const attr of resolveAttrShortNames(tabKeys, ['size', 'length'])) {
          emitConstraint(attr, scaleHit, i, e, { operator: 'degree', cost: len === 2 ? 1.5 : 2 });
        }
      }
    }

    // Comparatives with optional degree adverb ("a lot bigger", "much tinier", "a bit shorter", "a bit later")
    const kbComp = mapGet(kb?.domain?.comparatives, tok.lower);
    if (tok.kind === 'word' && (COMPARATIVE_SPECS.has(tok.lower) || kbComp)) {
      const spec =
        COMPARATIVE_SPECS.get(tok.lower) ??
        {
          dir: kbComp?.way === 'less' ? 'less' : 'more',
          targets: kbComp?.scale ? [kbComp.scale, 'size'] : ['size'],
        };
      const step = spec.dir === 'less' ? 'less' : 'more';
      const targetAttrs = resolveAttrShortNames(tabKeys, spec.targets);
      for (const attr of targetAttrs) {
        const shortK = attr.split('.').slice(1).join('.');
        const isPrimary = shortK === spec.targets[0] || shortK === 'size';
        emitConstraint(attr, '', i, i, { operator: 'delta', step, cost: isPrimary ? 1.5 : 5 });
      }
    }
    for (let advLen = 1; advLen <= 2 && i + advLen < T; advLen++) {
      const advEnd = i + advLen - 1;
      if (hasPunctInSpan(tokens, i, advEnd + 1)) break;
      const advPh = spanTextLower(tokens, i, advEnd);
      const strength = DEGREE_ADVERBS.get(advPh);
      if (!strength) continue;
      const compTok = tokens[advEnd + 1];
      const kbAdvComp = mapGet(kb?.domain?.comparatives, compTok.lower);
      const spec =
        COMPARATIVE_SPECS.get(compTok.lower) ??
        (kbAdvComp
          ? {
              dir: kbAdvComp.way === 'less' ? 'less' : 'more',
              targets: kbAdvComp.scale ? [kbAdvComp.scale, 'size'] : ['size'],
            }
          : null);
      if (spec) {
        const step =
          spec.dir === 'less'
            ? strength === 'strong'
              ? 'much_less'
              : 'less'
            : strength === 'strong'
              ? 'much_more'
              : 'more';
        for (const attr of resolveAttrShortNames(tabKeys, spec.targets)) {
          const shortK = attr.split('.').slice(1).join('.');
          const isPrimary = shortK === spec.targets[0] || shortK === 'size';
          emitConstraint(attr, '', i, advEnd + 1, { operator: 'delta', step, cost: isPrimary ? 1 : 4.5 });
        }
      }
    }
    // Multiplicative comparatives: "twice as big", "half as wide"
    if (i + 2 < T && ['twice', 'half'].includes(tok.lower) && tokens[i + 1].lower === 'as') {
      const factorVal = tok.lower === 'twice' ? '2' : '0.5';
      for (const attr of resolveAttrShortNames(tabKeys, ['size', 'scale', 'width', 'height', 'length'])) {
        emitConstraint(attr, factorVal, i, i + 2, { operator: 'factor', cost: 1.5 });
      }
    }

    // 10d. Spatial & Temporal Relations (1..5 tokens)
    for (let len = 1; len <= 5 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      const spRel = SPATIAL_RELATIONS.get(ph);
      const tmRel = TEMPORAL_RELATIONS.get(ph);
      if (spRel || tmRel) {
        for (const attr of relationKeys) {
          const isTemporalAttr = attr === 'meeting.relation' || attr === 'section.order';
          const relVal = isTemporalAttr ? tmRel ?? spRel : spRel ?? tmRel;
          if (!relVal) continue;
          // Restrict section.order / meeting.relation to values valid for that key if closed
          const spec = tabKeys.get(attr);
          if (spec.values && !spec.values.has(relVal)) continue;
          emitConstraint(attr, relVal, i, e, {
            operator: 'relation',
            on: 'place',
            phase: 'result',
            needsAnchor: true,
            // In diagram tab, "by" almost always marks chart.dimension/colourBy rather than node.position=near!
            cost: (tab === 'diagram' && ph === 'by') ? 7 : (len > 1 ? 1.5 : 2.5),
          });
        }
      }
    }

    // 10e. Coordinates (atomic "260,180" OR "[number, ',', number]")
    if (tok.kind === 'coord') {
      for (const fam of coordFamilies) {
        emitConstraint(`${fam}.x`, tok.coordX, i, i, {
          on: 'place',
          pairedConstraints: [
            { attribute: `${fam}.x`, value: tok.coordX, on: 'place' },
            { attribute: `${fam}.y`, value: tok.coordY, on: 'place' },
          ],
          cost: 1,
        });
      }
    } else if (
      tok.kind === 'number' &&
      i + 2 < T &&
      tokens[i + 1].text === ',' &&
      tokens[i + 2].kind === 'number'
    ) {
      const cx = tok.text;
      const cy = tokens[i + 2].text;
      for (const fam of coordFamilies) {
        emitConstraint(`${fam}.x`, cx, i, i + 2, {
          on: 'place',
          pairedConstraints: [
            { attribute: `${fam}.x`, value: cx, on: 'place' },
            { attribute: `${fam}.y`, value: cy, on: 'place' },
          ],
          cost: 1.5,
        });
      }
    }

    // 10f. Numbers & Number+Unit (also "a/an <unit>" -> measure=1, and comma-separated chart.values lists like "27, 23")
    if (tab === 'diagram' && tok.kind === 'number' && tabKeys.has('chart.values') && i + 2 < T && tokens[i + 1].text === ',' && tokens[i + 2].kind === 'number') {
      let endIdx = i + 2;
      while (endIdx + 2 < T && tokens[endIdx + 1].text === ',' && tokens[endIdx + 2].kind === 'number') {
        endIdx += 2;
      }
      const listVal = src.slice(tok.start, tokens[endIdx].end);
      emitConstraint('chart.values', listVal, i, endIdx, { cost: 1.5 });
    }

    const isArticleUnit = tok.kind === 'word' && (tok.lower === 'a' || tok.lower === 'an') && i + 1 < T && UNIT_CANON.has(tokens[i + 1].lower);
    const numVal = isArticleUnit ? 1 : parseNumeric(tok);
    if (numVal !== null) {
      // Check [num, unit]
      let matchedUnit = false;
      if (i + 1 < T && UNIT_CANON.has(tokens[i + 1].lower)) {
        const unit = UNIT_CANON.get(tokens[i + 1].lower);
        const mWords = src.slice(tok.start, tokens[i + 1].end);
        const isDurationFor = i > 0 && ['for', 'of'].includes(tokens[i - 1].lower);
        const isShiftTrail = i + 2 < T && ['later', 'earlier', 'ahead', 'back', 'forward'].includes(tokens[i + 2].lower);
        let unitTargets = [];
        if (['minute', 'hour'].includes(unit)) {
          unitTargets = isShiftTrail ? ['shift', 'length', 'duration'] : isDurationFor ? ['length', 'duration'] : ['length', 'duration', 'shift'];
        } else if (unit === 'second') unitTargets = ['duration', 'length'];
        else if (unit === 'degree') unitTargets = ['rotation', 'skew'];
        else if (unit === 'word') unitTargets = ['words'];
        else if (unit === 'chapter') unitTargets = ['chapters'];
        else if (unit === 'bin') unitTargets = ['bins'];
        else if (unit === 'row') unitTargets = ['rows'];
        else if (unit === 'column') unitTargets = ['columns'];
        else if (unit === 'seat') unitTargets = ['seats', 'capacity'];
        else if (unit === 'level') unitTargets = ['level', 'contourLevels'];
        else if (unit === 'decimal') unitTargets = ['precision'];
        else if (unit === 'percent') unitTargets = ['scale', 'size', 'opacity', 'width', 'height'];
        else if (['pixel', 'inch', 'cm', 'mm'].includes(unit)) {
          unitTargets = ['width', 'height', 'size', 'distance', 'offset', 'stroke', 'x', 'y'];
        }
        const attrs = resolveAttrShortNames(tabKeys, unitTargets);
        const APPROX_WORDS = new Set(['approximately', 'roughly', 'around', 'about']);
        const hasApproxBefore = i > 0 && tokens[i - 1].kind === 'word' && APPROX_WORDS.has(tokens[i - 1].lower);
        for (const attr of attrs) {
          matchedUnit = true;
          const shortK = attr.split('.').slice(1).join('.');
          const unitCost = shortK === 'shift' && !isShiftTrail ? 6 : 2;
          emitConstraint(attr, String(numVal), i, i + 1, {
            measure: numVal,
            unit,
            measureWords: mWords,
            requiresKeyWord: false,
            cost: unitCost,
          });
          if (hasApproxBefore) {
            emitConstraint(attr, String(numVal), i - 1, i + 1, {
              measure: numVal,
              unit,
              measureWords: tok.text,
              character: 'preference',
              requiresKeyWord: false,
              cost: unitCost - 0.5,
            });
          }
        }
      }

      // Calendar "at 3" -> meeting.time / meeting.start
      if (tab === 'calendar' && i > 0 && tokens[i - 1].lower === 'at' && tok.kind === 'number' && numVal >= 0 && numVal <= 24) {
        if (tabKeys.has('meeting.time')) emitConstraint('meeting.time', tok.text, i, i, { cost: 2 });
        if (tabKeys.has('meeting.start')) emitConstraint('meeting.start', tok.text, i, i, { cost: 2.5 });
      }

      // Bare number constraints for number keys on the tab (NEVER allow bare word "pair"/"one" as x/y coordinates!)
      if (!matchedUnit || tok.kind === 'number') {
        const isFractionalUnit = tok.kind === 'number' && numVal > 0 && numVal <= 1 && tok.text.includes('.');
        const isPartIndex = i > 0 && tokens[i - 1].lower === 'part' && Number.isInteger(numVal);
        if (isPartIndex && tabKeys.has('part.index')) {
          emitConstraint('part.index', String(numVal), i, i, { requiresKeyWord: false, cost: 1.5 });
        }
        for (const attr of numberKeys) {
          const shortKey = attr.split('.').slice(1).join('.');
          const isInt = Number.isInteger(numVal);
          const allowBare = (['values', 'value'].includes(shortKey))
            || (isInt && ['count', 'level', 'bins', 'index', 'distance'].includes(shortKey))
            || (isFractionalUnit && ['barWidth', 'opacity', 'scale', 'pieRadius', 'labelPosition'].includes(shortKey));
          const bareCost = isFractionalUnit && shortKey === 'barWidth' ? 2 : shortKey === 'distance' ? 5.5 : 6;
          emitConstraint(attr, String(numVal), i, i, {
            requiresKeyWord: !allowBare,
            cost: allowBare ? bareCost : 4,
          });
        }
      }
    }

    // 10g. Dates, Times, Timezones (calendar & page.time)
    if (tok.kind === 'date' && tabKeys.has('meeting.day')) {
      emitConstraint('meeting.day', tok.text, i, i, { cost: 1 });
    }
    if (tok.kind === 'word' && (WEEKDAYS.has(tok.lower) || RELATIVE_DAYS.has(tok.lower))) {
      if (tabKeys.has('meeting.day')) {
        emitConstraint('meeting.day', tok.lower, i, i, { cost: 1.5 });
      }
      if (i > 0 && DAY_MODIFIERS.has(tokens[i - 1].lower) && tabKeys.has('meeting.day')) {
        emitConstraint('meeting.day', `${tokens[i - 1].lower} ${tok.lower}`, i - 1, i, { cost: 1 });
      }
    }

    if (tok.kind === 'time') {
      const hasEndPrep = i > 0 && ['to', 'until', 'till'].includes(tokens[i - 1].lower);
      if (tabKeys.has('meeting.time')) {
        emitConstraint('meeting.time', tok.text, i, i, { cost: hasEndPrep ? 3 : 1.5 });
      }
      if (tabKeys.has('meeting.end')) {
        emitConstraint('meeting.end', tok.text, i, i, { cost: hasEndPrep ? 1 : 3.5 });
      }
    } else if (tok.kind === 'number' && i + 1 < T && ['am', 'pm'].includes(tokens[i + 1].lower)) {
      const tVal = src.slice(tok.start, tokens[i + 1].end);
      const hasEndPrep = i > 0 && ['to', 'until', 'till'].includes(tokens[i - 1].lower);
      if (tabKeys.has('meeting.time')) {
        emitConstraint('meeting.time', tVal, i, i + 1, { cost: hasEndPrep ? 3 : 1.5 });
      }
      if (tabKeys.has('meeting.end')) {
        emitConstraint('meeting.end', tVal, i, i + 1, { cost: hasEndPrep ? 1 : 3.5 });
      }
    }

    for (let len = 1; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      if (TIME_OF_DAY_PHRASES.has(ph)) {
        const tv = TIME_OF_DAY_PHRASES.get(ph);
        if (tabKeys.has('meeting.time')) emitConstraint('meeting.time', tv, i, e, { cost: 1.5 });
        if (tabKeys.has('page.time')) emitConstraint('page.time', tv, i, e, { cost: 2 });
      }
    }

    if (tok.isTimezone && tabKeys.has('meeting.timezone')) {
      emitConstraint('meeting.timezone', tok.text, i, i, { cost: 1 });
    }

    // 10h. Domain knowledge values per tab
    for (let len = 1; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      const ph = spanTextLower(tokens, i, e);
      const forms = singularisePhrase(ph, kb);

      if (tab === 'drawing') {
        if (ph === 'drop shadow' || ph === 'shadow') {
          if (tabKeys.has('drawn.effect')) emitConstraint('drawn.effect', 'shadow', i, e, { cost: 1.5 });
          if (tabKeys.has('part.effect')) emitConstraint('part.effect', 'shadow', i, e, { cost: 1.5 });
        }
        if (/^(looking|facing) (left|right|up|down|forward|back)$/.test(ph)) {
          const dir = ph.split(' ')[1];
          if (tabKeys.has('drawn.facing')) emitConstraint('drawn.facing', dir, i, e, { cost: 1.5 });
        }
        if (len === 1 && tabKeys.has('drawn.pose')) {
          const POSE_BASE = { run: 'running', walk: 'walking', sit: 'sitting', stand: 'standing', jump: 'jumping', wave: 'waving', dance: 'dancing', sleep: 'sleeping', fly: 'flying', swim: 'swimming' };
          if (POSE_BASE[ph]) emitConstraint('drawn.pose', POSE_BASE[ph], i, e, { cost: 2 });
        }
        for (const f of forms) {
          const sc = vocabMatch(kb?.domain?.scenes, f);
          if (sc && tabKeys.has('page.scene')) emitConstraint('page.scene', sc, i, e, { cost: 2 });

          const fl = vocabMatch(kb?.domain?.feelings, f);
          if (fl && tabKeys.has('drawn.expression')) emitConstraint('drawn.expression', fl, i, e, { cost: 2 });

          const st = vocabMatch(kb?.domain?.styles, f);
          if (st) {
            for (const attr of ['page.style', 'page.filter', 'drawn.font', 'drawn.fill', 'drawn.effect', 'drawn.material', 'drawn.frame']) {
              if (tabKeys.has(attr)) emitConstraint(attr, st, i, e, { cost: 2.5 });
            }
          }

          const wr = vocabMatch(kb?.domain?.wearables, f);
          if (wr) {
            if (tabKeys.has('drawn.wear')) emitConstraint('drawn.wear', wr, i, e, { cost: 2 });
            if (tabKeys.has('part.variant')) emitConstraint('part.variant', wr, i, e, { cost: 2.5 });
            if (tabKeys.has('part.value')) emitConstraint('part.value', wr, i, e, { cost: 2.5 });
          }

          const bp = vocabMatch(kb?.domain?.bodyParts, f);
          if (bp && tabKeys.has('part.ids')) {
            emitConstraint('part.ids', bp, i, e, { phase: 'selector', cost: 3 });
          }

          const ly = vocabMatch(kb?.domain?.layouts, f);
          if (ly && tabKeys.has('drawn.arrangement')) {
            emitConstraint('drawn.arrangement', ly, i, e, { cost: 2 });
          }
        }
      } else if (tab === 'diagram') {
        if (['same gap', 'equal gap', 'even gap', 'equal spacing', 'same spacing'].includes(ph)) {
          if (tabKeys.has('node.gap')) emitConstraint('node.gap', 'equal', i, e, { cost: 1.5 });
          if (tabKeys.has('diagram.spacing')) emitConstraint('diagram.spacing', 'equal', i, e, { cost: 2 });
        }
        if (['paired view', 'paired', 'side by side'].includes(ph)) {
          if (tabKeys.has('chart.compare')) emitConstraint('chart.compare', 'side_by_side', i, e, { cost: 1.5 });
        }
        const chPhrase = CHART_TYPE_PHRASES.get(ph);
        if (chPhrase) {
          if (tabKeys.has('chart.type')) emitConstraint('chart.type', chPhrase, i, e, { cost: 1.5 });
          if (tabKeys.has('chart.layout')) emitConstraint('chart.layout', chPhrase, i, e, { cost: 6 });
        }
        const aggVal = CHART_AGG_WORDS.get(ph);
        if (aggVal && tabKeys.has('chart.aggregate')) {
          emitConstraint('chart.aggregate', aggVal, i, e, { cost: 2 });
        }
        const dkPhrase = DIAGRAM_KIND_PHRASES.get(ph);
        if (dkPhrase && tabKeys.has('diagram.kind')) {
          const isChartKind = dkPhrase.endsWith('_chart');
          emitConstraint('diagram.kind', dkPhrase, i, e, { cost: isChartKind ? 16 : 3 });
        }
        for (const f of forms) {
          const ch = vocabMatch(kb?.domain?.charts, f);
          if (ch) {
            if (tabKeys.has('chart.type')) emitConstraint('chart.type', ch, i, e, { cost: 1.5 });
            if (tabKeys.has('chart.layout')) emitConstraint('chart.layout', ch, i, e, { cost: 6 });
          }
          const dg = vocabMatch(kb?.domain?.diagrams, f);
          if (dg && !String(dg).endsWith('_chart') && !String(dg).includes(' ') && tabKeys.has('diagram.kind')) {
            emitConstraint('diagram.kind', dg, i, e, { cost: 2.5 });
          }
          const sh = vocabMatch(kb?.domain?.shapes, f);
          if (sh) {
            for (const attr of ['node.shape', 'node.kind', 'chart.markerType']) {
              if (tabKeys.has(attr)) emitConstraint(attr, sh, i, e, { cost: 2.5 });
            }
          }
          const ly = vocabMatch(kb?.domain?.layouts, f);
          if (ly) {
            for (const attr of ['diagram.layout', 'group.layout', 'node.layout']) {
              if (tabKeys.has(attr)) emitConstraint(attr, ly, i, e, { cost: 2.5 });
            }
          }
        }
      } else if (tab === 'document') {
        if (['in the centre', 'in the center', 'in the middle', 'centred', 'centered'].includes(ph)) {
          for (const attr of ['block.align', 'section.align', 'inline.align']) {
            if (tabKeys.has(attr)) emitConstraint(attr, 'center', i, e, { cost: 2 });
          }
        }
        if (['top level', 'level 1', 'level one'].includes(ph)) {
          for (const attr of ['section.level', 'block.level']) {
            if (tabKeys.has(attr)) emitConstraint(attr, '1', i, e, { cost: 2 });
          }
        }
        for (const f of forms) {
          const gen = vocabMatch(kb?.domain?.genres, f);
          if (gen) {
            if (tabKeys.has('text.genre')) emitConstraint('text.genre', gen, i, e, { cost: 2 });
            if (tabKeys.has('document.genre')) emitConstraint('document.genre', gen, i, e, { cost: 2.5 });
          }
        }
      }
    }

    // 10i. Quoted open spans anywhere (multi-word prose prefers *.content / *.text over *.name / *.title)
    if (tok.kind === 'quote' && tok.inner) {
      const isProseQuote = tok.inner.includes(' ') || /[.!?]$/.test(tok.inner);
      for (const attr of spanKeys) {
        const sk = attr.split('.').slice(1).join('.');
        const qCost = isProseQuote
          ? (sk === 'content' || sk === 'text' ? 1.5 : 5)
          : 3;
        emitConstraint(attr, tok.inner, i, i, { cost: qCost });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 10j. Preposition / Cue / Key-Word-Anchored Open Spans
  // -------------------------------------------------------------------------
  // Collect KeyWord triggers (index -> attrs) so open spans right after KEY_WORD get emitted
  const kwTriggerAtEndTok = new Map();
  for (const c of rawCandidates) {
    if (c.kind !== HYP_KINDS.KEY_WORD) continue;
    if (!kwTriggerAtEndTok.has(c.endTok)) kwTriggerAtEndTok.set(c.endTok, new Set());
    for (const a of c.attrs) kwTriggerAtEndTok.get(c.endTok).add(a);
  }

  const OPEN_SPAN_BARRIERS = new Set([
    'above', 'below', 'under', 'underneath', 'beneath', 'behind', 'near', 'beside',
    'between', 'inside', 'outside', 'around', 'along', 'across', 'before', 'after', 'ahead',
    'in', 'on', 'at', 'for', 'from', 'to', 'into', 'onto', 'with', 'by', 'per', 'about', 'regarding',
    'containing', 'saying', 'called', 'named', 'titled', 'labelled', 'labeled',
    'approximately', 'roughly', 'then', 'but', 'however', 'whereas',
  ]);

  const emitOpenSpansStartingAt = (s, targetAttrs, opts = {}) => {
    const maxLen = opts.maxLen ?? 4;
    for (let len = 1; len <= maxLen && s + len <= T; len++) {
      const e = s + len - 1;
      if (hasPunctInSpan(tokens, s, e)) break;
      // Never swallow dates, times, or quotes into a multi-word unquoted open span
      if (len > 1 && (tokens[e].kind === 'date' || tokens[e].kind === 'time' || tokens[e].kind === 'quote')) break;
      // Stop if span hits a structural preposition, cue, or spatial/temporal relation barrier
      if (tokens[e].kind === 'word' && OPEN_SPAN_BARRIERS.has(tokens[e].lower)) break;
      if (tokens[e].kind === 'word' && ['and', 'also'].includes(tokens[e].lower) && len === 1) break;
      if (isPureGrammarOrVerbSpan(tokens, s, e, kb)) continue;
      // Never start/end open span with determiner-only or trailing prep
      if (tokens[s].isGrammar && !tokens[s].isProperCandidate) continue;
      if (len > 1 && tokens[e].isGrammar && !tokens[e].isProperCandidate) continue;

      const spanVal =
        len === 1 && tokens[s].kind === 'quote'
          ? tokens[s].inner
          : src.slice(tokens[s].start, tokens[e].end);

      for (const attr of targetAttrs) {
        if (!tabKeys.has(attr)) continue;
        // Enforce check.mjs rule: chart.measure / chart.dimension never all grammar/verb
        if (/^chart\.(measure|dimension)$/.test(attr) && isPureGrammarOrVerbSpan(tokens, s, e, kb)) {
          continue;
        }
        const coverStart = opts.includeTriggerTok !== undefined ? opts.includeTriggerTok : s;
        // Scale open-span cost with token length so structured parses beat giant catch-all open spans!
        const baseCost = opts.cost ?? 10;
        const attrExtra = (attr === 'diagram.about' || attr === 'page.scene' || attr === 'drawn.about') ? 8 : 0;
        emitConstraint(attr, spanVal, coverStart, e, {
          phase: opts.phase ?? phaseHintForAttr(attr),
          operator: opts.operator ?? operatorForAttr(attr, spanVal, tabKeys),
          isAnchor: Boolean(opts.isAnchor),
          requiresKeyWord: Boolean(opts.requiresKeyWord),
          cost: baseCost + attrExtra + (len - 1) * 4,
        });
      }
    }
  };

  for (let i = 0; i < T; i++) {
    const tok = tokens[i];
    // Skip optional determiner immediately after trigger at i
    const nextStart =
      i + 1 < T && tokens[i + 1].kind === 'word' && DET_MAP.has(tokens[i + 1].lower) && !tokens[i + 1].isProperCandidate
        ? i + 2
        : i + 1;

      // Key-word triggered open span (also allows explicitly key-word-anchored open_value on closed keys at higher cost!)
    if (kwTriggerAtEndTok.has(i) && nextStart < T) {
      const kwAll = [...kwTriggerAtEndTok.get(i)];
      const kwSpanAttrs = kwAll.filter((a) => {
        const sp = tabKeys.get(a);
        return sp && (sp.head.includes('span') || sp.head.includes('candidate'));
      });
      if (kwSpanAttrs.length > 0) {
        emitOpenSpansStartingAt(nextStart, kwSpanAttrs, { requiresKeyWord: true, cost: 2.5 });
        if (nextStart !== i + 1 && i + 1 < T) {
          emitOpenSpansStartingAt(i + 1, kwSpanAttrs, { requiresKeyWord: true, cost: 3 });
        }
      }
    }
    // "<KEY_WORD> of <target> to <VAL>" (e.g. "set the role of the diamond to connector"):
    if (tok.kind === 'word' && tok.lower === 'to' && nextStart < T) {
      const nearbyKwAttrs = new Set();
      for (let back = Math.max(0, i - 5); back < i; back++) {
        if (kwTriggerAtEndTok.has(back)) {
          for (const a of kwTriggerAtEndTok.get(back)) nearbyKwAttrs.add(a);
        }
      }
      if (nearbyKwAttrs.size > 0) {
        emitOpenSpansStartingAt(nextStart, [...nearbyKwAttrs], { requiresKeyWord: true, allowOpen: true, cost: 3.5, maxLen: 2 });
      }
    }

    // Spatial / temporal / order relation anchor triggers (up to 5 tokens, e.g. "on the right side of")
    for (let rLen = 1; rLen <= 5 && i - rLen + 1 >= 0; rLen++) {
      const rStart = i - rLen + 1;
      if (hasPunctInSpan(tokens, rStart, i)) break;
      const rPh = spanTextLower(tokens, rStart, i);
      if ((SPATIAL_RELATIONS.has(rPh) || TEMPORAL_RELATIONS.has(rPh)) && nextStart < T) {
        if (anchorKeys.length > 0) {
          emitOpenSpansStartingAt(nextStart, anchorKeys, {
            phase: 'selector',
            operator: 'relation',
            isAnchor: true,
            cost: 2.5,
          });
        }
        if (tab === 'drawing' && rPh === 'behind' && tabKeys.has('drawn.behind')) {
          emitOpenSpansStartingAt(nextStart, ['drawn.behind'], { phase: 'selector', cost: 2.5 });
        }
        if (tab === 'drawing' && rPh === 'on' && tabKeys.has('drawn.seat')) {
          emitOpenSpansStartingAt(nextStart, ['drawn.seat'], { phase: 'selector', cost: 3 });
        }
      }
    }

    // Specific preposition & structural verb triggers
    if (tok.kind === 'word' && nextStart < T) {
      if (tok.lower === 'from') {
        if (tab === 'diagram') emitOpenSpansStartingAt(nextStart, ['link.from', 'chart.datasets', 'chart.dateRange'], { phase: 'result', cost: 4 });
      } else if (tok.lower === 'to' || tok.lower === 'into') {
        if (tab === 'diagram') emitOpenSpansStartingAt(nextStart, ['link.to'], { phase: 'result', cost: 4 });
        if (tab === 'document') {
          emitOpenSpansStartingAt(nextStart, ['inline.link_target', 'section.text', 'block.text', 'text.title'], { phase: 'result', cost: 6 });
        }
        // After rename/retitle/relabel ... to <newName>
        if (tab === 'calendar') {
          const hasRenameBefore = tokens.slice(Math.max(0, i - 4), i).some((t) => ['rename', 'renamed', 'retitle', 'call', 'called', 'named'].includes(t.lower));
          if (hasRenameBefore && tokens[nextStart].kind !== 'time' && tokens[nextStart].kind !== 'date') {
            emitOpenSpansStartingAt(nextStart, ['meeting.title', 'calendar.name', 'room.name'], { phase: 'result', cost: 3 });
          }
        }
      } else if (tab === 'diagram' && ['connect', 'link', 'join', 'wire'].includes(tok.lower)) {
        emitOpenSpansStartingAt(nextStart, ['link.from'], { phase: 'result', cost: 3, maxLen: 2 });
      } else if (tab === 'diagram' && CHART_AGG_WORDS.has(tok.lower)) {
        emitOpenSpansStartingAt(nextStart, ['chart.measure'], { phase: 'result', cost: 3, maxLen: 3 });
      } else if (tok.lower === 'of') {
        if (tab === 'diagram') emitOpenSpansStartingAt(nextStart, ['chart.measure', 'diagram.about'], { phase: 'result', cost: 4 });
        if (tab === 'drawing') emitOpenSpansStartingAt(nextStart, ['part.owner'], { phase: 'selector', cost: 5 });
      } else if (tok.lower === 'for') {
        if (tab === 'diagram') {
          emitOpenSpansStartingAt(nextStart, ['chart.measure', 'diagram.about'], { phase: 'result', cost: 4 });
          // Coordinated chart labels after "for" ("for Shop and Sample", "for Triage, Testing and Billing")
          if (tabKeys.has('chart.labels') && tokens[nextStart]?.isProperCandidate) {
            let endLbl = nextStart;
            while (endLbl + 2 < T && (tokens[endLbl + 1].lower === 'and' || tokens[endLbl + 1].text === ',') && tokens[endLbl + 2].isProperCandidate) {
              endLbl += 2;
            }
            if (endLbl > nextStart) {
              emitConstraint('chart.labels', src.slice(tokens[nextStart].start, tokens[endLbl].end), nextStart, endLbl, { cost: 2 });
            }
          }
        }
        if (tab === 'drawing') {
          // "swap the dog for a cat" / "substitute X for Y" -> drawn.kind!
          emitOpenSpansStartingAt(nextStart, ['drawn.kind'], { phase: 'result', cost: 4, maxLen: 2 });
        }
        if (tab === 'calendar') {
          // "book Hall for Planning" -> meeting.title (never durations like "for 45 minutes")!
          const nt = tokens[nextStart];
          if (nt && nt.kind !== 'number' && !numberWords.has(nt.lower)) {
            emitOpenSpansStartingAt(nextStart, ['meeting.title'], { phase: 'result', cost: 3, maxLen: 3 });
          }
        }
      } else if (tab === 'drawing' && tok.lower === 'because' && i + 1 < T && tokens[i + 1].lower === 'of') {
        const afterOf = (i + 2 < T && DET_MAP.has(tokens[i + 2].lower)) ? i + 3 : i + 2;
        if (afterOf < T) emitOpenSpansStartingAt(afterOf, ['drawn.cause'], { requiresKeyWord: true, cost: 2, maxLen: 3 });
      } else if (tab === 'drawing' && (tok.lower === 'holding' || tok.lower === 'holds')) {
        emitOpenSpansStartingAt(nextStart, ['drawn.holds'], { requiresKeyWord: true, cost: 2, maxLen: 2 });
      } else if (tab === 'calendar' && ['book', 'schedule', 'reserve'].includes(tok.lower)) {
        // "book Room 4 for Planning" vs "book Planning in Hall": if "for <non-number>" follows, the direct object is room/venue!
        const hasForNonNum = tokens.slice(nextStart + 1, Math.min(T, nextStart + 5)).some((t, idx, arr) =>
          t.lower === 'for' && arr[idx + 1] && arr[idx + 1].kind !== 'number' && !numberWords.has(arr[idx + 1].lower)
        );
        emitOpenSpansStartingAt(nextStart, ['meeting.room'], { phase: 'result', cost: hasForNonNum ? 1.5 : 3.5, maxLen: 2 });
        emitOpenSpansStartingAt(nextStart, ['meeting.title'], { phase: 'result', cost: hasForNonNum ? 4.5 : 2.5, maxLen: 3 });
      } else if (tok.lower === 'by' || tok.lower === 'per' || tok.lower === 'across') {
        if (tab === 'diagram') {
          emitOpenSpansStartingAt(nextStart, ['chart.dimension', 'chart.colourBy'], { phase: 'result', cost: 2.5 });
          emitOpenSpansStartingAt(nextStart, ['chart.dimension'], {
            includeTriggerTok: i,
            phase: 'result',
            cost: 2.5,
          });
        }
      } else if (tok.lower === 'about' || tok.lower === 'regarding') {
        if (tab === 'document') emitOpenSpansStartingAt(nextStart, ['text.about', 'document.topic', 'section.content'], { cost: 4 });
        if (tab === 'diagram') emitOpenSpansStartingAt(nextStart, ['diagram.about'], { cost: 6 });
        if (tab === 'drawing') emitOpenSpansStartingAt(nextStart, ['drawn.about', 'drawn.cause'], { cost: 6 });
      } else if (tok.lower === 'with') {
        if (tab === 'calendar') emitOpenSpansStartingAt(nextStart, ['meeting.people', 'meeting.participants'], { cost: 4 });
        if (tab === 'drawing') emitOpenSpansStartingAt(nextStart, ['composition.with', 'drawn.holds', 'drawn.wear'], { cost: 6 });
        if (tab === 'diagram') emitOpenSpansStartingAt(nextStart, ['composition.with'], { cost: 6 });
      } else if (tok.lower === 'in' || tok.lower === 'at' || tok.lower === 'on') {
        if (tab === 'calendar') {
          // Type discipline: meeting.room / meeting.calendar NEVER capture time or date tokens ("at 10:00", "on 2026-11-18")!
          // Prepositional semantics: "on <Work 4>" -> meeting.calendar; "in/at <Hall / Room 4>" -> meeting.room!
          const nt = tokens[nextStart];
          if (nt && nt.kind !== 'time' && nt.kind !== 'date' && !WEEKDAYS.has(nt.lower) && !RELATIVE_DAYS.has(nt.lower) && !TIME_OF_DAY_PHRASES.has(nt.lower)) {
            if (tok.lower === 'on') {
              emitOpenSpansStartingAt(nextStart, ['meeting.calendar'], { cost: 2.5 });
              emitOpenSpansStartingAt(nextStart, ['meeting.room'], { cost: 6.5 });
            } else {
              emitOpenSpansStartingAt(nextStart, ['meeting.room'], { cost: 2.5 });
              emitOpenSpansStartingAt(nextStart, ['meeting.calendar'], { cost: 6.5 });
            }
          }
        }
        if (tab === 'drawing') emitOpenSpansStartingAt(nextStart, ['page.scene', 'page.style'], { cost: 10 });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 11. UNREAD fallback candidates (every content token + 2..3 token phrases)
  // -------------------------------------------------------------------------
  for (let i = 0; i < T; i++) {
    if (!tokens[i].isContent) continue;
    emit({
      kind: HYP_KINDS.UNREAD,
      startTok: i,
      endTok: i,
      cost: 120,
    });

    for (let len = 2; len <= 3 && i + len <= T; len++) {
      const e = i + len - 1;
      if (hasPunctInSpan(tokens, i, e)) break;
      if (!tokens[e].isContent) continue;
      let contentCount = 0;
      for (let k = i; k <= e; k++) {
        if (tokens[k].isContent) contentCount++;
      }
      if (contentCount < 2) continue;
      emit({
        kind: HYP_KINDS.UNREAD,
        startTok: i,
        endTok: e,
        cost: 105 * contentCount,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Deduplicate identical candidates (keeping lowest cost) & assign IDs
  // -------------------------------------------------------------------------
  const deduped = new Map();
  for (const c of rawCandidates) {
    const key = [
      c.kind,
      c.startTok,
      c.endTok,
      c.attribute ?? '',
      c.value ?? '',
      c.family ?? '',
      c.sort ?? '',
      c.fill ?? '',
      c.name ?? '',
      c.negWant ?? '',
      c.operator ?? '',
      c.step ?? '',
      c.phase ?? '',
      c.isAnchor ? 1 : 0,
      c.requiresKeyWord ? 1 : 0,
      c.pairedConstraints ? JSON.stringify(c.pairedConstraints) : '',
      c.attrs ? c.attrs.join(',') : '',
    ].join('|');

    const prev = deduped.get(key);
    if (!prev || c.cost < prev.cost) {
      deduped.set(key, c);
    }
  }

  const candidates = [...deduped.values()].sort(
    (a, b) => a.startTok - b.startTok || a.endTok - b.endTok || a.kind.localeCompare(b.kind) || a.cost - b.cost
  );
  for (let idx = 0; idx < candidates.length; idx++) {
    candidates[idx].id = idx;
  }

  return {
    text: src,
    tab,
    previous,
    clock,
    tokens,
    candidates,
    splitPoints,
    hasQuestionMark: src.includes('?'),
  };
}
