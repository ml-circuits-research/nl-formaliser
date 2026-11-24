// Standalone, generic, world-agnostic Z3 MaxSMT Spellchecker / Orthographic Normaliser (Layer 1).
// Uses z3-solver WASM directly with a persistent (push 1)/(pop 1) context.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSpellVocab, extractVocabFromKb } from './vocab.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const TZ_PATH_RE = /^[A-Z][A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/;
const TZ_ABBR_RE = /^(?:UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|CET|CEST|EET|EEST|BST|IST|JST)$/;
const CODE_RE = /^[$@]?(?:[a-zA-Z]{1,2}\d+|\d+[a-zA-Z]{1,2})$/;
const NAME_INTRO_WORDS = new Set(['called', 'named', 'titled', 'labelled', 'labeled']);
const SENTENCE_END_PUNCT = new Set(['.', '!', '?', ';', '\n']);

const TOKEN_PATTERNS = [
  { kind: 'quote', re: /"(?:[^"\\]|\\.)*"|“[^”]*”/y },
  { kind: 'date', re: /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?(?![A-Za-z0-9_])/y },
  { kind: 'time', re: /\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm))?(?![A-Za-z0-9_])|\d{1,2}(?:am|pm)(?![A-Za-z0-9_])/iy },
  { kind: 'entity', re: /[A-Z][A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?(?![A-Za-z0-9_])/y },
  { kind: 'coord', re: /-?(?:\d+(?:\.\d+)?|\.\d+)[,]-?(?:\d+(?:\.\d+)?|\.\d+)(?![A-Za-z0-9_])/y },
  { kind: 'number', re: /-?(?:\d+(?:\.\d+)?|\.\d+)(?:st|nd|rd|th|%|px|pt|em|cm|mm|in)?(?![A-Za-z0-9_])/iy },
  { kind: 'code', re: /[$@]?(?:[A-Za-z]{1,2}\d+|\d+[A-Za-z]{1,2})(?![A-Za-z0-9_])/y },
  { kind: 'word', re: /[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/y },
];

async function loadZ3Module(explicitModule) {
  if (explicitModule) return explicitModule;
  const candidates = [
    join(ROOT, 'node_modules', 'z3-solver', 'build', 'node.js'),
    join(ROOT, '..', 'soplang-words-lib', 'experiments', 'node_modules', 'z3-solver', 'build', 'node.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return await import(pathToFileURL(p).href);
  }
  return await import('z3-solver');
}

function parseSmtBools(output) {
  const lines = String(output || '').split(/\r?\n/);
  const statusLine = lines.find((l) => /^(sat|unsat|unknown)\b/.test(l.trim()))?.trim() ?? 'unknown';
  const values = new Map();
  if (statusLine !== 'sat') return { status: statusLine, values };

  const re = /\(\s*([A-Za-z0-9_]+)\s+(true|false)\s*\)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    values.set(m[1], m[2] === 'true');
  }
  return { status: statusLine, values };
}

function preserveInitialCase(rawFirstToken, normWord) {
  if (!rawFirstToken || !normWord) return normWord;
  if (/^[A-Z]/.test(rawFirstToken)) {
    return normWord[0].toUpperCase() + normWord.slice(1);
  }
  return normWord;
}

function isValidSplitPiece(piece, vocab) {
  if (!vocab.hasWord(piece)) return false;
  return piece.length >= 2 || piece === 'a' || piece === 'i';
}

function isHorizSpace(ws) {
  return ws.length > 0 && /^[ \t]+$/.test(ws);
}

/**
 * Tokenize `text` preserving exact [start, end) offsets, whitespace gaps,
 * and Hard Entity Shield classification.
 */
function segmentText(text, vocab) {
  const src = String(text ?? '');
  const segments = [];
  let pos = 0;
  let pendingWs = '';
  let atSentenceStart = true;

  while (pos < src.length) {
    if (/\s/.test(src[pos])) {
      const wsStart = pos;
      while (pos < src.length && /\s/.test(src[pos])) pos++;
      const ws = src.slice(wsStart, pos);
      pendingWs += ws;
      if (ws.includes('\n')) atSentenceStart = true;
      continue;
    }

    let matched = null;
    for (const spec of TOKEN_PATTERNS) {
      if (spec.kind === 'number' && src[pos] === '-' && pos > 0 && /[A-Za-z0-9_]/.test(src[pos - 1])) {
        continue;
      }
      spec.re.lastIndex = pos;
      const m = spec.re.exec(src);
      if (m) {
        matched = { kind: spec.kind, raw: m[0], start: pos, end: pos + m[0].length };
        break;
      }
    }

    if (!matched) {
      matched = { kind: 'punct', raw: src[pos], start: pos, end: pos + 1 };
    }

    const raw = matched.raw;
    const lower = raw.toLowerCase().replace(/\u2019/g, "'");
    const isWord = matched.kind === 'word';

    let isProtected = !isWord;
    if (isWord) {
      const startsUpper = /^[A-Z]/.test(raw);
      const allCaps = raw.length >= 2 && /^[A-Z]+$/.test(raw);
      const prevSeg = segments.length > 0 ? segments[segments.length - 1] : null;
      const afterNameIntro = prevSeg && prevSeg.isWord && NAME_INTRO_WORDS.has(prevSeg.lower);

      if (allCaps || TZ_ABBR_RE.test(raw) || TZ_PATH_RE.test(raw) || CODE_RE.test(raw)) {
        isProtected = true;
      } else if (startsUpper && !atSentenceStart) {
        // Hard Entity Shield: never corrupt mid-sentence capitalized proper names.
        isProtected = true;
      } else if (afterNameIntro && (startsUpper || !vocab.hasWord(lower))) {
        isProtected = true;
      } else if (vocab.exactOnlySet?.has(lower)) {
        isProtected = true;
      }
    }

    let inVocab = false;
    if (isWord && !isProtected) {
      inVocab = vocab.hasWord(lower);
      // Accept hyphenated compounds like "x-axis" or "top-left" when each part is known.
      if (!inVocab && lower.includes('-')) {
        const parts = lower.split('-').filter(Boolean);
        if (parts.length >= 2 && parts.every((p) => vocab.hasWord(p))) inVocab = true;
      }
    }

    const seg = {
      index: segments.length,
      text: raw,
      lower,
      start: matched.start,
      end: matched.end,
      leadingWs: pendingWs,
      kind: isWord ? 'WORD' : matched.kind.toUpperCase(),
      isWord,
      protected: isProtected,
      inVocab,
      isOov: isWord && !isProtected && !inVocab,
      capitalize: isWord && !isProtected && /^[A-Z]/.test(raw),
    };
    segments.push(seg);
    pendingWs = '';
    pos = matched.end;

    if (matched.kind === 'punct' && SENTENCE_END_PUNCT.has(raw)) {
      atSentenceStart = true;
    } else if (isWord || matched.kind === 'quote' || matched.kind === 'number' || matched.kind === 'code') {
      atSentenceStart = false;
    }
  }

  return { segments, trailingWs: pendingWs };
}

function computeInternalPairBonus(w1, w2, vocab) {
  if (vocab.hasBigram(w1, w2)) return 4;
  if (vocab.isHighFreq(w1) && vocab.isHighFreq(w2)) return 2;
  if ((vocab.isHighFreq(w1) && vocab.hasWord(w2)) || (vocab.hasWord(w1) && vocab.isHighFreq(w2))) return 1;
  return 0;
}

function buildOrthographicLattice(segments, vocab) {
  const candidates = [];
  const segCover = Array.from({ length: segments.length }, () => []);

  function addCand(c) {
    const id = candidates.length;
    const cand = { ...c, id, varName: `c_${id}` };
    candidates.push(cand);
    for (let s = cand.startSeg; s <= cand.endSeg; s++) {
      segCover[s].push(cand);
    }
    return cand;
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.protected) {
      addCand({
        startSeg: i,
        endSeg: i,
        words: [seg.text],
        op: seg.kind === 'PUNCT' ? 'punct' : 'pass_through',
        smtCost: 0,
        editCost: 0,
        inVocabTarget: false,
      });
      continue;
    }

    if (seg.inVocab) {
      addCand({
        startSeg: i,
        endSeg: i,
        words: [seg.text],
        op: 'keep',
        smtCost: 0,
        editCost: 0,
        inVocabTarget: true,
      });
      continue;
    }

    // OOV word segment: always include RAW_UNKNOWN fallback so valid unknown domain words aren't mangled.
    const q = seg.lower;
    const rawUnknownCost = q.length <= 4 ? 10 : 17;
    addCand({
      startSeg: i,
      endSeg: i,
      words: [seg.text],
      op: 'raw_unknown',
      smtCost: rawUnknownCost,
      editCost: rawUnknownCost,
      inVocabTarget: false,
    });

    // 1-token edits (dist 1 for len >= 3, dist 2 for len >= 5).
    if (q.length >= 3 && /^[a-z]+$/.test(q)) {
      const maxDist = q.length >= 5 ? 2 : 1;
      const hits = vocab.lookup(q, { maxDist });
      const d1NonTransCount = hits.filter((h) => h.dist === 1 && h.kind !== 'transpose' && h.kind !== 'doubled').length;
      const d2Count = hits.filter((h) => h.dist === 2).length;

      let kept = 0;
      for (const h of hits) {
        if (kept >= 6) break;
        if (h.dist === 2 && (q.length < 5 || h.word.length < 5)) continue;

        let cost;
        if (h.dist === 1) {
          if (h.kind === 'transpose' || h.kind === 'doubled') {
            cost = 5;
          } else if (h.kind === 'ins' || h.kind === 'del') {
            cost = 7;
          } else {
            cost = q.length <= 4 ? 10 : 9;
          }
          // Short-word neighborhood-density guard prevents corrupting valid short unknown words (e.g. "sail").
          if (q.length <= 4 && h.kind !== 'transpose' && h.kind !== 'doubled' && !h.isHighFreq) {
            cost += Math.min(5, Math.max(0, d1NonTransCount - 2));
          }
        } else {
          // dist === 2 on len >= 5
          cost = d2Count <= 2 ? 15 : 18;
        }

        const outWord = seg.capitalize ? preserveInitialCase(seg.text, h.word) : h.word;
        addCand({
          startSeg: i,
          endSeg: i,
          words: [outWord],
          op: 'edit',
          smtCost: cost,
          editCost: cost,
          inVocabTarget: true,
        });
        kept++;
      }
    }

    // 1-token SPLIT (1 -> 2 words), e.g. "onthe" -> "on the", "onte" -> "on the".
    if (q.length >= 4 && /^[a-z]+$/.test(q)) {
      const seenSplits = new Set();
      for (let k = 1; k < q.length; k++) {
        const left = q.slice(0, k);
        const right = q.slice(k);

        // Exact split (0 char edits).
        if (isValidSplitPiece(left, vocab) && isValidSplitPiece(right, vocab)) {
          const key = `${left}\0${right}`;
          if (!seenSplits.has(key)) {
            seenSplits.add(key);
            const hasHf = vocab.isHighFreq(left) || vocab.isHighFreq(right);
            const rawSplitCost = hasHf ? 4 : 8;
            const bonus = computeInternalPairBonus(left, right, vocab);
            const smtCost = Math.max(1, rawSplitCost - bonus);
            addCand({
              startSeg: i,
              endSeg: i,
              words: [seg.capitalize ? preserveInitialCase(seg.text, left) : left, right],
              op: 'split',
              smtCost,
              editCost: rawSplitCost,
              inVocabTarget: true,
            });
          }
          continue;
        }

        // Split + 1 char edit when the anchor half is a high-frequency word (e.g. "onte" -> "on the").
        if (vocab.isHighFreq(left) && right.length >= 2 && right.length <= 6) {
          const rightHits = vocab.lookup(right, { maxDist: 1 });
          let added = 0;
          for (const rh of rightHits) {
            if (!rh.isHighFreq && rh.word.length < 4) continue;
            if (rh.word.length < 2 && rh.word !== 'a' && rh.word !== 'i') continue;
            const key = `${left}\0${rh.word}`;
            if (seenSplits.has(key)) continue;
            seenSplits.add(key);
            const rawCost = rh.isHighFreq ? 8 : 11;
            const bonus = computeInternalPairBonus(left, rh.word, vocab);
            const smtCost = Math.max(1, rawCost - bonus);
            addCand({
              startSeg: i,
              endSeg: i,
              words: [seg.capitalize ? preserveInitialCase(seg.text, left) : left, rh.word],
              op: 'split',
              smtCost,
              editCost: rawCost,
              inVocabTarget: true,
            });
            if (++added >= 4) break;
          }
        } else if (vocab.isHighFreq(right) && left.length >= 2 && left.length <= 6) {
          const leftHits = vocab.lookup(left, { maxDist: 1 });
          let added = 0;
          for (const lh of leftHits) {
            if (!lh.isHighFreq && lh.word.length < 4) continue;
            if (lh.word.length < 2 && lh.word !== 'a' && lh.word !== 'i') continue;
            const key = `${lh.word}\0${right}`;
            if (seenSplits.has(key)) continue;
            seenSplits.add(key);
            const rawCost = lh.isHighFreq ? 8 : 11;
            const bonus = computeInternalPairBonus(lh.word, right, vocab);
            const smtCost = Math.max(1, rawCost - bonus);
            addCand({
              startSeg: i,
              endSeg: i,
              words: [seg.capitalize ? preserveInitialCase(seg.text, lh.word) : lh.word, right],
              op: 'split',
              smtCost,
              editCost: rawCost,
              inVocabTarget: true,
            });
            if (++added >= 4) break;
          }
        }
      }
    }
  }

  // 2-token MERGE & SHIFT_SPACE windows (anti-corruption: only when at least 1 token is OOV!).
  for (let i = 0; i + 1 < segments.length; i++) {
    const s1 = segments[i];
    const s2 = segments[i + 1];
    if (!s1.isWord || !s2.isWord || s1.protected || s2.protected) continue;
    if (!isHorizSpace(s2.leadingWs)) continue;
    if (!s1.isOov && !s2.isOov) continue;
    if (!/^[a-z]+$/.test(s1.lower) || !/^[a-z]+$/.test(s2.lower)) continue;

    const concat = s1.lower + s2.lower;
    if (concat.length > 24) continue;

    if (vocab.hasWord(concat)) {
      addCand({
        startSeg: i,
        endSeg: i + 1,
        words: [s1.capitalize ? preserveInitialCase(s1.text, concat) : concat],
        op: 'merge',
        smtCost: 4,
        editCost: 4,
        inVocabTarget: true,
      });
    } else if (concat.length >= 5) {
      const hits = vocab.lookup(concat, { maxDist: 1 });
      if (hits.length > 0) {
        const h = hits[0];
        addCand({
          startSeg: i,
          endSeg: i + 1,
          words: [s1.capitalize ? preserveInitialCase(s1.text, h.word) : h.word],
          op: 'merge',
          smtCost: 10,
          editCost: 10,
          inVocabTarget: true,
        });
      }
    }

    // SHIFT_SPACE: try every other split point k != s1.lower.length.
    for (let k = 1; k < concat.length; k++) {
      if (k === s1.lower.length) continue;
      const left = concat.slice(0, k);
      const right = concat.slice(k);
      if (!isValidSplitPiece(left, vocab) || !isValidSplitPiece(right, vocab)) continue;

      const rawCost = 5;
      const bonus = computeInternalPairBonus(left, right, vocab);
      const smtCost = Math.max(1, rawCost - bonus);
      addCand({
        startSeg: i,
        endSeg: i + 1,
        words: [s1.capitalize ? preserveInitialCase(s1.text, left) : left, right],
        op: 'shift_space',
        smtCost,
        editCost: rawCost,
        inVocabTarget: true,
      });
    }
  }

  // 3-token MERGE & SHIFT_SPACE windows (when at least 1 token is OOV).
  for (let i = 0; i + 2 < segments.length; i++) {
    const s1 = segments[i];
    const s2 = segments[i + 1];
    const s3 = segments[i + 2];
    if (!s1.isWord || !s2.isWord || !s3.isWord) continue;
    if (s1.protected || s2.protected || s3.protected) continue;
    if (!isHorizSpace(s2.leadingWs) || !isHorizSpace(s3.leadingWs)) continue;
    if (!s1.isOov && !s2.isOov && !s3.isOov) continue;
    if (!/^[a-z]+$/.test(s1.lower) || !/^[a-z]+$/.test(s2.lower) || !/^[a-z]+$/.test(s3.lower)) continue;

    const concat3 = s1.lower + s2.lower + s3.lower;
    if (concat3.length > 24) continue;

    if (vocab.hasWord(concat3)) {
      addCand({
        startSeg: i,
        endSeg: i + 2,
        words: [s1.capitalize ? preserveInitialCase(s1.text, concat3) : concat3],
        op: 'merge',
        smtCost: 6,
        editCost: 6,
        inVocabTarget: true,
      });
    }

    for (let k = 1; k < concat3.length; k++) {
      const left = concat3.slice(0, k);
      const right = concat3.slice(k);
      if (!isValidSplitPiece(left, vocab) || !isValidSplitPiece(right, vocab)) continue;
      const rawCost = 7;
      const bonus = computeInternalPairBonus(left, right, vocab);
      const smtCost = Math.max(1, rawCost - bonus);
      addCand({
        startSeg: i,
        endSeg: i + 2,
        words: [s1.capitalize ? preserveInitialCase(s1.text, left) : left, right],
        op: 'shift_space',
        smtCost,
        editCost: rawCost,
        inVocabTarget: true,
      });
    }
  }

  return { candidates, segCover };
}

function encodeSpellSmt(segments, lattice, vocab) {
  const { candidates, segCover } = lattice;
  const lines = [];
  const queryVars = [];
  const choiceVars = [];
  const bigramEdges = [];

  for (const c of candidates) {
    lines.push(`(declare-const ${c.varName} Bool)`);
    queryVars.push(c.varName);
    if (segCover.some((list, sIdx) => sIdx >= c.startSeg && sIdx <= c.endSeg && list.length > 1)) {
      choiceVars.push(c.varName);
    }
  }

  // Exact cover over every segment.
  for (let s = 0; s < segments.length; s++) {
    const cov = segCover[s];
    if (cov.length === 1) {
      lines.push(`(assert ${cov[0].varName})`);
    } else {
      const names = cov.map((c) => c.varName).join(' ');
      lines.push(`(assert (or ${names}))`);
      lines.push(`(assert ((_ at-most 1) ${names}))`);
    }
  }

  // Soft edit penalties.
  for (const c of candidates) {
    if (c.smtCost > 0) {
      lines.push(`(assert-soft (not ${c.varName}) :weight ${c.smtCost})`);
    }
  }

  // Soft bigram/phrase rewards across adjacent segments separated only by whitespace.
  for (let s = 0; s + 1 < segments.length; s++) {
    const nextSeg = segments[s + 1];
    if (!nextSeg.leadingWs) continue;
    if (segCover[s].length <= 1 && segCover[s + 1].length <= 1) continue;

    const endingAtS = segCover[s].filter((c) => c.endSeg === s && c.words.length > 0);
    const startingAtNext = segCover[s + 1].filter((c) => c.startSeg === s + 1 && c.words.length > 0);

    for (const c1 of endingAtS) {
      const w1 = c1.words[c1.words.length - 1].toLowerCase();
      for (const c2 of startingAtNext) {
        const w2 = c2.words[0].toLowerCase();
        let bonus = 0;
        if (vocab.hasBigram(w1, w2)) bonus = 4;
        else if (vocab.isHighFreq(w1) && vocab.isHighFreq(w2)) bonus = 3;
        else if ((vocab.isHighFreq(w1) && c2.inVocabTarget) || (c1.inVocabTarget && vocab.isHighFreq(w2))) bonus = 1;

        if (bonus > 0) {
          lines.push(`(assert-soft (and ${c1.varName} ${c2.varName}) :weight ${bonus})`);
          bigramEdges.push({ c1Id: c1.id, c2Id: c2.id, bonus });
        }
      }
    }
  }

  return {
    smtBody: lines.join('\n'),
    queryVars,
    choiceVars,
    bigramEdges,
  };
}

function decodeModel(rawText, segments, trailingWs, lattice, bigramEdges, valuesMap) {
  const chosen = [];
  const chosenIds = new Set();
  for (const c of lattice.candidates) {
    if (valuesMap.get(c.varName) === true) {
      chosen.push(c);
      chosenIds.add(c.id);
    }
  }
  chosen.sort((a, b) => a.startSeg - b.startSeg);

  let cleanText = '';
  let totalEditCost = 0;
  let smtCostSum = 0;
  const tokens = [];

  for (const c of chosen) {
    const firstSeg = segments[c.startSeg];
    const lastSeg = segments[c.endSeg];
    cleanText += firstSeg.leadingWs + c.words.join(' ');
    totalEditCost += c.editCost;
    smtCostSum += c.smtCost;

    const rawStart = firstSeg.start;
    const rawEnd = lastSeg.end;
    const rawSpan = rawText.slice(rawStart, rawEnd);
    const perTokCost = c.words.length > 0 ? c.editCost / c.words.length : 0;

    for (const w of c.words) {
      tokens.push({
        text: w,
        rawText: rawSpan,
        rawStart,
        rawEnd,
        op: c.op,
        editCost: perTokCost,
      });
    }
  }
  cleanText += trailingWs;

  let bonusEarned = 0;
  for (const edge of bigramEdges) {
    if (chosenIds.has(edge.c1Id) && chosenIds.has(edge.c2Id)) {
      bonusEarned += edge.bonus;
    }
  }

  return {
    cleanText,
    totalEditCost,
    objectiveCost: smtCostSum - bonusEarned,
    tokens,
    chosen,
  };
}

/**
 * Create a standalone Z3 MaxSMT spellchecker / orthographic normaliser (Layer 1).
 *
 * @param {object} opts
 * @param {object} [opts.vocab] - Built vocab from `buildSpellVocab` / `extractVocabFromKb`, or plain `{ words, highFreqWords, phrases }`.
 * @param {object} [opts.kb] - Optional `loadKnowledge()` output if `vocab` is omitted.
 * @param {string} [opts.tab] - Optional tab filter when extracting from `kb`.
 * @param {number} [opts.timeoutMs=2000]
 * @param {object} [opts.module] - Optional preloaded z3-solver module.
 */
export async function createSpellChecker({
  vocab: rawVocab,
  kb,
  tab,
  timeoutMs = 2000,
  module: explicitModule,
} = {}) {
  let vocab;
  if (rawVocab) {
    vocab = typeof rawVocab.lookup === 'function' ? rawVocab : buildSpellVocab(rawVocab);
  } else if (kb) {
    vocab = extractVocabFromKb(kb, { tab });
  } else {
    throw new Error('createSpellChecker requires either { vocab } or { kb }');
  }

  const z3Mod = await loadZ3Module(explicitModule);
  const { Context, Z3 } = await z3Mod.init();
  let ctx = new Context('nl_spell_l1');
  let solveCount = 0;

  async function maybeReset() {
    if (solveCount > 0 && solveCount % 250 === 0) {
      ctx = new Context(`nl_spell_l1_${solveCount}`);
    }
  }

  async function normalise(text, { topK = 1, timeout = timeoutMs } = {}) {
    const t0 = performance.now();
    const rawText = String(text ?? '');
    const { segments, trailingWs } = segmentText(rawText, vocab);

    const hasOov = segments.some((s) => s.isOov);
    if (!hasOov) {
      const tokens = segments.map((s) => ({
        text: s.text,
        rawText: s.text,
        rawStart: s.start,
        rawEnd: s.end,
        op: s.kind === 'PUNCT' ? 'punct' : s.protected ? 'pass_through' : 'keep',
        editCost: 0,
      }));
      const elapsedMs = performance.now() - t0;
      return {
        ok: true,
        rawText,
        cleanText: rawText,
        changed: false,
        usedZ3: false,
        totalEditCost: 0,
        margin: null,
        tokens,
        alternatives: topK >= 2 ? [{ cleanText: rawText, totalEditCost: 0, tokens }] : [],
        elapsedMs,
      };
    }

    await maybeReset();
    solveCount++;

    const lattice = buildOrthographicLattice(segments, vocab);
    const encoded = encodeSpellSmt(segments, lattice, vocab);

    const blocks = [];
    const uniqueSols = [];
    const seenTexts = new Set();
    const maxIters = Math.max(topK, topK + 3);
    const queryStr = encoded.queryVars.length ? `(get-value (${encoded.queryVars.join(' ')}))` : '';

    for (let iter = 0; iter < maxIters && uniqueSols.length < topK; iter++) {
      const script = [
        '(push 1)',
        `(set-option :timeout ${timeout})`,
        encoded.smtBody,
        ...blocks,
        '(check-sat)',
        queryStr,
        '(pop 1)',
      ].join('\n');

      const rawOut = await Z3.eval_smtlib2_string(ctx.ptr, script);
      if (/\(error\b/.test(String(rawOut))) {
        try { await Z3.eval_smtlib2_string(ctx.ptr, '(pop 1)'); } catch {}
        if (uniqueSols.length > 0) break;
        return {
          ok: false,
          status: 'error',
          error: String(rawOut).trim(),
          rawText,
          cleanText: rawText,
          changed: false,
          usedZ3: true,
          totalEditCost: 0,
          margin: null,
          tokens: [],
          alternatives: [],
          elapsedMs: performance.now() - t0,
        };
      }

      const parsed = parseSmtBools(rawOut);
      if (parsed.status !== 'sat') break;

      const decoded = decodeModel(rawText, segments, trailingWs, lattice, encoded.bigramEdges, parsed.values);
      if (!seenTexts.has(decoded.cleanText)) {
        seenTexts.add(decoded.cleanText);
        uniqueSols.push(decoded);
      }

      if (uniqueSols.length < topK) {
        const chosenChoiceLits = [];
        for (const v of encoded.choiceVars) {
          if (parsed.values.get(v) === true) chosenChoiceLits.push(`(not ${v})`);
        }
        if (chosenChoiceLits.length > 0) {
          blocks.push(`(assert (or ${chosenChoiceLits.join(' ')}))`);
        } else {
          break;
        }
      }
    }

    uniqueSols.sort((a, b) => a.objectiveCost - b.objectiveCost || a.totalEditCost - b.totalEditCost);
    const best = uniqueSols[0];
    const elapsedMs = performance.now() - t0;

    if (!best) {
      return {
        ok: false,
        status: 'unsat',
        rawText,
        cleanText: rawText,
        changed: false,
        usedZ3: true,
        totalEditCost: 0,
        margin: null,
        tokens: [],
        alternatives: [],
        elapsedMs,
      };
    }

    const margin = topK >= 2 && uniqueSols.length >= 2
      ? uniqueSols[1].objectiveCost - uniqueSols[0].objectiveCost
      : null;

    const alternatives = uniqueSols.map((sol) => ({
      cleanText: sol.cleanText,
      totalEditCost: sol.totalEditCost,
      tokens: sol.tokens,
    }));

    return {
      ok: true,
      rawText,
      cleanText: best.cleanText,
      changed: best.cleanText !== rawText,
      usedZ3: true,
      totalEditCost: best.totalEditCost,
      margin,
      tokens: best.tokens,
      alternatives,
      elapsedMs,
    };
  }

  return {
    vocab,
    normalise,
  };
}
