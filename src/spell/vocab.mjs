// Standalone, world-agnostic SymSpell delete-neighborhood vocabulary & KB adapter (Layer 1).
// Zero external dependencies. Supports any plain { words, highFreqWords, phrases } vocabulary
// as well as an optional extractVocabFromKb(kb, { tab }) adapter for SOP Lang worlds.

const CVC_VERB_RE = /^[bcdfghjklmnpqrstvwxyz]*[aeiou][bcdfghjklmnpqrstvxz]$/;
const PURE_WORD_RE = /^(?=.*[a-z])[a-z0-9]+(?:['-][a-z0-9]+)*$/;
const ALPHA_INFLECT_RE = /^[a-z]{2,}$/;

/**
 * Compute true Damerau-Levenshtein edit distance between strings `a` and `b`
 * (insertions, deletions, substitutions, adjacent transpositions).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function damerauLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;

  const maxDist = m + n;
  const cols = n + 2;
  // Flat (m+2) x (n+2) matrix for speed and zero nested-array GC overhead.
  const d = new Int32Array((m + 2) * cols);
  d[0] = maxDist;
  for (let i = 0; i <= m; i++) {
    d[(i + 1) * cols] = maxDist;
    d[(i + 1) * cols + 1] = i;
  }
  for (let j = 0; j <= n; j++) {
    d[j + 1] = maxDist;
    d[cols + j + 1] = j;
  }

  const da = new Map();
  for (let i = 1; i <= m; i++) {
    let db = 0;
    const chA = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const chB = b[j - 1];
      const i1 = da.get(chB) ?? 0;
      const j1 = db;
      let cost = 1;
      if (chA === chB) {
        cost = 0;
        db = j;
      }
      const sub = d[i * cols + j] + cost;
      const ins = d[(i + 1) * cols + j] + 1;
      const del = d[i * cols + j + 1] + 1;
      const trans = d[i1 * cols + j1] + (i - i1 - 1) + 1 + (j - j1 - 1);

      let best = sub < ins ? sub : ins;
      if (del < best) best = del;
      if (trans < best) best = trans;
      d[(i + 1) * cols + j + 1] = best;
    }
    da.set(chA, i);
  }
  return d[(m + 1) * cols + n + 1];
}

/**
 * Classify a distance <= 2 edit from `raw` to `cand` into a fine-grained typo kind.
 *
 * @param {string} raw
 * @param {string} cand
 * @returns {{ dist: number, kind: 'exact'|'transpose'|'doubled'|'ins'|'del'|'sub'|'dist2'|'far' }}
 */
export function analyzeEdit(raw, cand) {
  if (raw === cand) return { dist: 0, kind: 'exact' };
  const lr = raw.length;
  const lc = cand.length;

  if (lr === lc) {
    // Check single substitution or single adjacent transposition in O(L).
    let diff1 = -1;
    let diff2 = -1;
    let diffs = 0;
    for (let i = 0; i < lr; i++) {
      if (raw[i] !== cand[i]) {
        diffs++;
        if (diffs === 1) diff1 = i;
        else if (diffs === 2) diff2 = i;
        else break;
      }
    }
    if (diffs === 1) return { dist: 1, kind: 'sub' };
    if (diffs === 2 && diff2 === diff1 + 1 && raw[diff1] === cand[diff2] && raw[diff2] === cand[diff1]) {
      return { dist: 1, kind: 'transpose' };
    }
  } else if (lr + 1 === lc) {
    // One missing character in `raw` (insertion to reach `cand`).
    let i = 0;
    let j = 0;
    let skipped = false;
    let ok = true;
    while (i < lr && j < lc) {
      if (raw[i] === cand[j]) {
        i++;
        j++;
      } else if (!skipped) {
        skipped = true;
        j++;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) return { dist: 1, kind: 'ins' };
  } else if (lr === lc + 1) {
    // One extra character in `raw` (deletion to reach `cand`).
    let i = 0;
    let j = 0;
    let skippedIdx = -1;
    let ok = true;
    while (i < lr && j < lc) {
      if (raw[i] === cand[j]) {
        i++;
        j++;
      } else if (skippedIdx === -1) {
        skippedIdx = i;
        i++;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (skippedIdx === -1) skippedIdx = lr - 1;
      const ch = raw[skippedIdx];
      const isDoubled = (skippedIdx > 0 && raw[skippedIdx - 1] === ch)
        || (skippedIdx + 1 < lr && raw[skippedIdx + 1] === ch);
      return { dist: 1, kind: isDoubled ? 'doubled' : 'del' };
    }
  }

  const dist = damerauLevenshtein(raw, cand);
  if (dist === 2) return { dist: 2, kind: 'dist2' };
  return { dist, kind: 'far' };
}

function normWord(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\u2019/g, "'");
}

function addEntryWords(entry, wordSet, phraseSet) {
  if (typeof entry === 'string' && /^[a-z]+$/.test(entry)) {
    wordSet.add(entry);
    return;
  }
  const s = normWord(entry);
  if (!s) return;
  if (!s.includes(' ') && !s.includes('_')) {
    if (PURE_WORD_RE.test(s)) wordSet.add(s);
    return;
  }
  const normalizedSpaces = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalizedSpaces.includes(' ')) {
    phraseSet.add(normalizedSpaces);
    for (const part of normalizedSpaces.split(' ')) {
      if (PURE_WORD_RE.test(part)) wordSet.add(part);
    }
  } else if (PURE_WORD_RE.test(normalizedSpaces)) {
    wordSet.add(normalizedSpaces);
  }
  if (s !== normalizedSpaces && !s.includes(' ') && /^[a-z0-9_'-]+$/.test(s)) {
    wordSet.add(s);
  }
}

function generateDeletes1(word, out) {
  const len = word.length;
  for (let i = 0; i < len; i++) {
    out.push(word.slice(0, i) + word.slice(i + 1));
  }
}

function generateDeletes2(word, out) {
  const len = word.length;
  for (let i = 0; i < len; i++) {
    const d1 = word.slice(0, i) + word.slice(i + 1);
    out.push(d1);
    const l1 = d1.length;
    if (l1 >= 2) {
      for (let j = i; j < l1; j++) {
        out.push(d1.slice(0, j) + d1.slice(j + 1));
      }
    }
  }
}

const KIND_PRIORITY = {
  exact: 0,
  transpose: 1,
  doubled: 2,
  ins: 3,
  del: 4,
  sub: 5,
  dist2: 6,
  far: 7,
};

/**
 * Build a fast, zero-dependency SymSpell delete-neighborhood index (max edit distance 2)
 * + bigram/phrase bonus set from any plain vocabulary.
 *
 * @param {object} opts
 * @param {Iterable<string>} opts.words
 * @param {Iterable<string>} [opts.highFreqWords]
 * @param {Iterable<string>} [opts.phrases]
 * @param {Iterable<string>} [opts.exactOnlyWords]
 * @returns {object}
 */
export function buildSpellVocab({
  words = [],
  highFreqWords = [],
  phrases = [],
  exactOnlyWords = [],
} = {}) {
  const t0 = performance.now();
  const wordSet = new Set();
  const highFreqSet = new Set();
  const phraseSet = new Set();
  const bigramSet = new Set();
  const exactOnlySet = new Set();

  for (const w of words) addEntryWords(w, wordSet, phraseSet);

  for (const hw of highFreqWords) {
    const s = normWord(hw);
    if (!s) continue;
    if (s.includes(' ')) {
      addEntryWords(s, wordSet, phraseSet);
    } else if (PURE_WORD_RE.test(s)) {
      highFreqSet.add(s);
      wordSet.add(s);
    }
  }

  for (const p of phrases) {
    const s = normWord(p).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.includes(' ')) {
      phraseSet.add(s);
      for (const part of s.split(' ')) {
        if (PURE_WORD_RE.test(part)) wordSet.add(part);
      }
    } else if (PURE_WORD_RE.test(s)) {
      wordSet.add(s);
    }
  }

  for (const ex of exactOnlyWords) {
    const s = normWord(ex);
    if (s && PURE_WORD_RE.test(s) && !wordSet.has(s)) {
      exactOnlySet.add(s);
    }
  }

  for (const ph of phraseSet) {
    const parts = ph.split(' ');
    for (let i = 0; i + 1 < parts.length; i++) {
      if (parts[i] && parts[i + 1]) {
        bigramSet.add(`${parts[i]}\0${parts[i + 1]}`);
      }
    }
  }

  // SymSpell delete-neighborhood map: deleteKey -> string[] (using O(1) last-element dedup).
  const PREFIX_LEN = 7;
  const deletes = new Map();

  function addDelete(del, w) {
    if (!del) return;
    let arr = deletes.get(del);
    if (!arr) {
      deletes.set(del, [w]);
    } else if (arr[arr.length - 1] !== w) {
      arr.push(w);
    }
  }

  for (const w of wordSet) {
    const len = w.length;
    if (len < 2) continue;
    const keySource = len > PREFIX_LEN ? w.slice(0, PREFIX_LEN) : w;
    if (len > PREFIX_LEN) addDelete(keySource, w);
    const kLen = keySource.length;
    if (kLen >= 4) {
      for (let i = 0; i < kLen; i++) {
        const d1 = keySource.slice(0, i) + keySource.slice(i + 1);
        addDelete(d1, w);
        const l1 = d1.length;
        if (l1 >= 2) {
          for (let j = i; j < l1; j++) {
            addDelete(d1.slice(0, j) + d1.slice(j + 1), w);
          }
        }
      }
    } else {
      for (let i = 0; i < kLen; i++) {
        addDelete(keySource.slice(0, i) + keySource.slice(i + 1), w);
      }
    }
  }

  const buildMs = performance.now() - t0;

  function hasWord(w) {
    const q = normWord(w);
    return wordSet.has(q);
  }

  function isKnownOrExact(w) {
    const q = normWord(w);
    return wordSet.has(q) || exactOnlySet.has(q);
  }

  function isHighFreq(w) {
    return highFreqSet.has(normWord(w));
  }

  function hasBigram(w1, w2) {
    return bigramSet.has(`${normWord(w1)}\0${normWord(w2)}`);
  }

  /**
   * Look up correction candidates for an OOV word within `maxDist <= 2`.
   * @param {string} rawQuery
   * @param {{ maxDist?: number }} [opts]
   */
  function lookup(rawQuery, { maxDist = 2 } = {}) {
    const q = normWord(rawQuery);
    if (!q) return [];
    if (wordSet.has(q)) {
      return [{ word: q, dist: 0, kind: 'exact', isHighFreq: highFreqSet.has(q) }];
    }
    const cappedDist = Math.min(2, Math.max(1, maxDist));
    const candSet = new Set();

    // Distance 0 query against deletes (handles pure insertions needed in q, e.g. selct -> select, or suffix typos).
    const qSource = q.length > PREFIX_LEN ? q.slice(0, PREFIX_LEN) : q;
    const directHits = deletes.get(qSource);
    if (directHits) {
      for (let i = 0; i < directHits.length; i++) candSet.add(directHits[i]);
    }
    if (qSource !== q && wordSet.has(qSource)) candSet.add(qSource);

    const qDeletes = [];
    if (cappedDist >= 2 && qSource.length >= 3) {
      generateDeletes2(qSource, qDeletes);
    } else if (qSource.length >= 2) {
      generateDeletes1(qSource, qDeletes);
    }

    for (let i = 0; i < qDeletes.length; i++) {
      const del = qDeletes[i];
      if (!del) continue;
      if (wordSet.has(del)) candSet.add(del);
      const hits = deletes.get(del);
      if (hits) {
        for (let j = 0; j < hits.length; j++) candSet.add(hits[j]);
      }
    }

    const results = [];
    for (const cand of candSet) {
      if (Math.abs(cand.length - q.length) > cappedDist) continue;
      const { dist, kind } = analyzeEdit(q, cand);
      if (dist <= cappedDist) {
        results.push({
          word: cand,
          dist,
          kind,
          isHighFreq: highFreqSet.has(cand),
        });
      }
    }

    results.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const ka = KIND_PRIORITY[a.kind] ?? 9;
      const kb = KIND_PRIORITY[b.kind] ?? 9;
      if (ka !== kb) return ka - kb;
      if (a.isHighFreq !== b.isHighFreq) return a.isHighFreq ? -1 : 1;
      return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
    });

    return results;
  }

  return {
    wordSet,
    highFreqSet,
    exactOnlySet,
    phraseSet,
    bigramSet,
    deletes,
    maxEditDistance: 2,
    stats: {
      wordCount: wordSet.size,
      highFreqCount: highFreqSet.size,
      phraseCount: phraseSet.size,
      deleteKeyCount: deletes.size,
      buildMs,
    },
    hasWord,
    isKnownOrExact,
    isHighFreq,
    hasBigram,
    lookup,
  };
}

function addVerbInflections(word, targetSet) {
  if (!ALPHA_INFLECT_RE.test(word)) return;
  targetSet.add(word);
  // +s / +es
  if (/(?:s|x|z|ch|sh)$/.test(word) || /[^aeiou]o$/.test(word)) {
    targetSet.add(`${word}es`);
  } else if (/[^aeiou]y$/.test(word)) {
    targetSet.add(`${word.slice(0, -1)}ies`);
  } else {
    targetSet.add(`${word}s`);
  }
  // +ed
  if (word.endsWith('e')) {
    targetSet.add(`${word}d`);
  } else if (/[^aeiou]y$/.test(word)) {
    targetSet.add(`${word.slice(0, -1)}ied`);
  } else {
    targetSet.add(`${word}ed`);
    if (word.length <= 5 && CVC_VERB_RE.test(word)) {
      targetSet.add(`${word}${word[word.length - 1]}ed`);
    }
  }
  // +ing
  if (word.endsWith('ie')) {
    targetSet.add(`${word.slice(0, -2)}ying`);
  } else if (word.endsWith('e') && !/(?:ee|ye|oe)$/.test(word)) {
    targetSet.add(`${word.slice(0, -1)}ing`);
  } else {
    targetSet.add(`${word}ing`);
    if (word.length <= 5 && CVC_VERB_RE.test(word)) {
      targetSet.add(`${word}${word[word.length - 1]}ing`);
    }
  }
}

function addPluralInflection(word, targetSet) {
  if (!ALPHA_INFLECT_RE.test(word)) return;
  targetSet.add(word);
  if (/(?:s|x|z|ch|sh)$/.test(word)) {
    targetSet.add(`${word}es`);
  } else if (/[^aeiou]y$/.test(word)) {
    targetSet.add(`${word.slice(0, -1)}ies`);
  } else if (!word.endsWith('s')) {
    targetSet.add(`${word}s`);
  }
  // Also add singular lemma if word is already plural (e.g. words -> word, bars -> bar).
  if (word.endsWith('ies') && word.length > 4) {
    targetSet.add(`${word.slice(0, -3)}y`);
  } else if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word) && word.length > 3) {
    targetSet.add(word.slice(0, -1));
  }
}

function addMapOrSetKeys(src, targetWords, { inflectPlural = false, targetPhrases = null } = {}) {
  if (!src) return;
  const iter = src instanceof Map ? src.keys() : src;
  for (const raw of iter) {
    const s = normWord(raw).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.includes(' ')) {
      if (targetPhrases) targetPhrases.add(s);
      for (const p of s.split(' ')) {
        targetWords.add(p);
        if (inflectPlural) addPluralInflection(p, targetWords);
      }
    } else {
      targetWords.add(s);
      if (inflectPlural) addPluralInflection(s, targetWords);
    }
  }
}

/**
 * Generic adapter extracting a plain { words, highFreqWords, phrases, exactOnlyWords }
 * vocabulary from a SOP Lang knowledge base (`loadKnowledge()`), then indexing it.
 *
 * @param {object} kb
 * @param {{ tab?: string }} [opts]
 * @returns {object}
 */
export function extractVocabFromKb(kb, { tab } = {}) {
  if (!kb || typeof kb !== 'object') {
    throw new Error('extractVocabFromKb requires a kb object');
  }

  const words = new Set();
  const highFreqWords = new Set();
  const phrases = new Set();
  const exactOnlyWords = new Set();

  // 1. Grammar & closed classes (high-frequency functional vocabulary).
  const g = kb.grammar ?? {};
  const hfCollections = [
    g.grammarWords,
    g.fillerWords,
    g.determiners,
    g.pronouns,
    g.prepositions,
    g.joiners,
    g.whWords,
    g.auxiliaries,
    g.negations,
    g.quantifiers,
  ];
  for (const col of hfCollections) {
    if (!col) continue;
    const iter = col instanceof Map ? col.keys() : col;
    for (const item of iter) {
      const s = normWord(item);
      if (!s) continue;
      if (s.includes(' ')) {
        phrases.add(s);
        for (const p of s.split(/\s+/)) highFreqWords.add(p);
      } else {
        highFreqWords.add(s);
      }
    }
  }

  addMapOrSetKeys(g.numbers, words);
  addMapOrSetKeys(g.ordinals, words, { targetPhrases: phrases });

  if (Array.isArray(g.contractions)) {
    for (const [contracted, expanded] of g.contractions) {
      if (contracted) words.add(normWord(contracted));
      if (expanded) {
        for (const p of normWord(expanded).split(/\s+/)) {
          words.add(p);
          highFreqWords.add(p);
        }
      }
    }
  }

  if (g.irregularPlurals instanceof Map) {
    for (const [plural, singular] of g.irregularPlurals) {
      words.add(normWord(plural));
      words.add(normWord(singular));
    }
  }
  if (g.irregularVerbs instanceof Map) {
    for (const [form, lemma] of g.irregularVerbs) {
      words.add(normWord(form));
      const lem = normWord(lemma);
      words.add(lem);
      addVerbInflections(lem, words);
    }
  }

  if (g.fillerPhrases) {
    for (const ph of g.fillerPhrases) addEntryWords(ph, words, phrases);
  }
  if (Array.isArray(g.cues)) {
    for (const cue of g.cues) {
      for (const lead of cue.lead ?? []) addEntryWords(lead, words, phrases);
    }
  }

  // Generate grammatical preposition + article phrases (e.g. "on the", "in a", "to the")
  // directly from KB grammar classes without hardcoding any domain/tab rules.
  if (g.prepositions instanceof Map && g.determiners instanceof Map) {
    const articles = [];
    for (const [detWord, info] of g.determiners) {
      if ((info?.det === 'definite' || info?.det === 'indefinite') && !detWord.includes(' ')) {
        articles.push(normWord(detWord));
      }
    }
    for (const prep of g.prepositions.keys()) {
      const p = normWord(prep);
      if (!p || p.includes(' ')) continue;
      for (const art of articles) phrases.add(`${p} ${art}`);
    }
  }

  // 2. Verbs & phrasal verbs from k.actions.
  if (kb.verbs instanceof Map) {
    for (const verbText of kb.verbs.keys()) {
      const s = normWord(verbText);
      if (!s) continue;
      if (s.includes(' ')) {
        phrases.add(s);
        const parts = s.split(/\s+/);
        for (let i = 0; i < parts.length; i++) {
          if (i === 0) addVerbInflections(parts[i], words);
          else words.add(parts[i]);
        }
      } else {
        addVerbInflections(s, words);
      }
    }
  }

  // 3. Tab keys, keyWords, closed values, and familyWords.
  const tabList = tab && kb.tabs?.[tab] ? [kb.tabs[tab]] : Object.values(kb.tabs ?? {});
  for (const t of tabList) {
    if (!t) continue;
    addMapOrSetKeys(t.keyWordIndex, words, { inflectPlural: true, targetPhrases: phrases });
    addMapOrSetKeys(t.closedValueIndex, words, { inflectPlural: true, targetPhrases: phrases });
    addMapOrSetKeys(t.familyWords, words, { inflectPlural: true, targetPhrases: phrases });
    for (const spec of t.keyList ?? []) {
      if (spec.shortName) {
        const spaced = spec.shortName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
        addEntryWords(spaced, words, phrases);
      }
      for (const kw of spec.keyWords ?? []) addEntryWords(kw, words, phrases);
      for (const val of spec.valuesRaw ?? []) addEntryWords(val, words, phrases);
    }
  }

  // 4. Domain lexicons (excluding givenNames from edit targets so proper names never hijack typos).
  const dom = kb.domain ?? {};
  const nounDomainFields = [
    'objects', 'bodyParts', 'wearables', 'shapes', 'scenes',
    'diagrams', 'charts', 'genres', 'units',
  ];
  const plainDomainFields = [
    'colours', 'shades', 'scales', 'comparatives', 'directions',
    'positions', 'feelings', 'layouts', 'styles',
  ];

  for (const field of nounDomainFields) {
    addMapOrSetKeys(dom[field], words, { inflectPlural: true, targetPhrases: phrases });
  }
  for (const field of plainDomainFields) {
    addMapOrSetKeys(dom[field], words, { inflectPlural: false, targetPhrases: phrases });
  }
  if (dom.time) {
    addMapOrSetKeys(dom.time.months, words, { inflectPlural: true });
    addMapOrSetKeys(dom.time.weekdays, words, { inflectPlural: true });
    addMapOrSetKeys(dom.time.partsOfDay, words, { inflectPlural: true });
    addMapOrSetKeys(dom.time.relativeDays, words, { targetPhrases: phrases });
  }
  if (dom.givenNames) {
    for (const gn of dom.givenNames) exactOnlyWords.add(normWord(gn));
  }

  return buildSpellVocab({ words, highFreqWords, phrases, exactOnlyWords });
}
