// Decoupled Layer 1 (Z3 Spellchecker) -> Layer 2 (Z3 Formaliser) Pipeline Bridge.
// Keeps `src/spell/*` 100% standalone while enabling raw-grounded formalisation over noisy inputs:
//   1) Layer 1 normalises raw text -> cleanText + exact [rawStart, rawEnd) provenance per token.
//   2) Layer 2 formalises cleanText -> w.request SOP Lang circuit.
//   3) Every emitted surface span (`words`, `predicate`, `sort_words`, `family_words`, `key_words`,
//      `name_words`, `count_words`, `measure_words`, `filler.text`, `unread.text`) is projected
//      back to the exact substring of `rawText` so `check.mjs` validates 100% against `rawText`!

import { unquoteSop, fmtSopValue } from './contracts.mjs';

/**
 * Build a clean-offset -> raw-offset alignment table from Layer 1 `spellRes.tokens`.
 */
export function buildCleanToRawAlignment(cleanText, spellTokens) {
  const entries = [];
  let cursor = 0;
  for (const tok of spellTokens ?? []) {
    if (!tok?.text) continue;
    const idx = cleanText.indexOf(tok.text, cursor);
    if (idx < 0) continue;
    entries.push({
      cleanStart: idx,
      cleanEnd: idx + tok.text.length,
      cleanText: tok.text,
      rawStart: tok.rawStart,
      rawEnd: tok.rawEnd,
      rawText: tok.rawText,
      op: tok.op,
    });
    cursor = idx + tok.text.length;
  }
  return entries;
}

/**
 * Map a substring `cleanSpan` of `cleanText` back to the exact covering substring of `rawText`.
 */
export function mapCleanSpanToRaw(cleanSpan, cleanText, rawText, alignment) {
  if (!cleanSpan) return cleanSpan;
  if (rawText.includes(cleanSpan)) return cleanSpan;
  const idx = cleanText.indexOf(cleanSpan);
  if (idx < 0 || !alignment.length) return null;
  const end = idx + cleanSpan.length;

  let minRaw = Infinity;
  let maxRaw = -1;
  for (const e of alignment) {
    if (e.cleanEnd <= idx || e.cleanStart >= end) continue;
    if (e.rawStart < minRaw) minRaw = e.rawStart;
    if (e.rawEnd > maxRaw) maxRaw = e.rawEnd;
  }
  if (minRaw < Infinity && maxRaw > minRaw) {
    return rawText.slice(minRaw, maxRaw);
  }
  return null;
}

const SURFACE_KEYS = new Set([
  'words',
  'predicate',
  'sort_words',
  'family_words',
  'key_words',
  'name_words',
  'count_words',
  'measure_words',
  'asked_words',
  'code_words',
  'description',
]);

/**
 * Re-ground a SOP Lang circuit emitted over `cleanText` so that every wire is 100% grounded
 * in `rawText` according to `check.mjs`.
 */
export function regroundSopToRaw(sopText, { rawText, cleanText, spellTokens, parse }) {
  if (!sopText || rawText === cleanText) return sopText;
  const alignment = buildCleanToRawAlignment(cleanText, spellTokens);
  let wires;
  try {
    wires = parse(sopText);
  } catch {
    return sopText;
  }

  const outLines = [];
  for (const w of wires) {
    const pairs = [];
    let hasWords = false;
    let sortVal = null;
    let hasSortWords = false;
    let constraintVals = [];

    for (const [k, vals] of Object.entries(w.attrs)) {
      if (k === 'words') hasWords = true;
      if (k === 'sort') sortVal = unquoteSop(vals[0]);
      if (k === 'sort_words') hasSortWords = true;
      if (k === 'value') constraintVals = vals.map(unquoteSop);

      for (const rawV of vals) {
        if (String(rawV).startsWith('$')) {
          pairs.push([k, rawV, true]);
          continue;
        }
        const v = unquoteSop(rawV);
        const isSurface = SURFACE_KEYS.has(k) || (k === 'text' && (w.type === 'w.request.filler' || w.type === 'w.request.unread'));
        if (isSurface) {
          const mapped = mapCleanSpanToRaw(v, cleanText, rawText, alignment);
          if (mapped && rawText.includes(mapped)) {
            pairs.push([k, mapped, false]);
          } else if (rawText.includes(v)) {
            pairs.push([k, v, false]);
          }
          // If an optional surface key cannot be grounded in rawText, omit rather than emit invalid phrase!
        } else {
          pairs.push([k, rawV, true]);
        }
      }
    }

    // Grounding repair: if `target.sort` was fixed from a typo (e.g. "atble" -> "table"),
    // `table` is not in rawText, so attach `sort_words=atble`!
    if (w.type === 'w.request.target' && sortVal && !hasSortWords && !new RegExp(`\\b${sortVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}e?s?\\b`, 'i').test(rawText)) {
      const mappedSort = mapCleanSpanToRaw(sortVal, cleanText, rawText, alignment);
      if (mappedSort && rawText.includes(mappedSort)) {
        pairs.push(['sort_words', mappedSort, false]);
      }
    }

    // Grounding repair: if a constraint value came from a typo (e.g. "beeside" -> "beside", "wiedr" -> "wider"),
    // attach `words=<raw>` when `value` isn't literally in `rawText`!
    if (w.type === 'w.request.constraint' && !hasWords && constraintVals.length > 0) {
      const missingVal = constraintVals.find((cv) => cv && !rawText.toLowerCase().includes(cv.toLowerCase()));
      if (missingVal) {
        const mappedVal = mapCleanSpanToRaw(missingVal, cleanText, rawText, alignment);
        if (mappedVal && rawText.includes(mappedVal) && mappedVal !== missingVal) {
          pairs.push(['words', mappedVal, false]);
        }
      }
    }

    const body = pairs
      .map(([k, v, rawAtom]) => `${k}=${rawAtom ? v : fmtSopValue(v)}`)
      .join(' ');
    outLines.push(`@${w.id} ${w.type}${body ? ' ' + body : ''}`);
  }
  return outLines.join('\n');
}
