// Dynamic w.lang.en.frame Compiler for nl-formaliser.
// Compiles declarative SOP Lang frames from `kb.grammar.frames` (property-frames.sop,
// diagram-frames.sop, role-frames.sop, shape-frames.sop, frames-acts*.sop, etc.) into
// structured argument-attachment hypotheses for Z3 MaxSMT (`src/smt/encode.mjs`).
//
// Zero hardcoded sentence templates: every frame pattern, lexicon, role, and fixed slot
// is read dynamically from `sop-knowledge-worlds`.

import { HYP_KINDS, ACTS, ACT_MODES, isIndependentValueCandidate } from '../contracts.mjs';
import { lemmatiseVerb, singularisePhrase } from './morph.mjs';
import { tokenize } from './tokenize.mjs';

const VALID_ACT_SET = new Set(ACTS);
const VALID_MODE_SET = new Set(ACT_MODES);
const MAX_FRAME_WINDOW = 28;

// Frame shards & families whose argument-structure roles directly disambiguate
// property-owner-value, old->new transition, diagram kind/topic/layout, edge labels,
// shape arrangements, materials, and replacements.
const SUPPORTED_ROLES = new Set([
  'attribute', 'thing', 'value', 'old', 'replacement', 'topic', 'of', 'whole',
  'criterion', 'rel', 'place', 'source', 'ends', 'link', 'arrangement',
  'kind', 'material', 'part', 'tool', 'target', 'group',
]);

const DET_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'all', 'every', 'each', 'both', 'some', 'any',
]);

const frameIndexCache = new WeakMap();

/**
 * Build a fast pre-compiled frame index per KB instance (~1 ms once per process).
 */
function getCompiledFrames(kb) {
  if (!kb?.grammar?.frames) return [];
  if (frameIndexCache.has(kb)) return frameIndexCache.get(kb);

  const compiled = [];
  const verbVariants = kb.grammar.ellipsis?.verbVariants ?? new Map();
  const coordinationAnchors = new Set([...verbVariants.values()].flatMap((names) => [...names]));
  for (const frame of kb.grammar.frames.values()) {
    if (!frame?.parts?.length) continue;
    if (!frame.act || !VALID_ACT_SET.has(frame.act)) continue;
    // Skip bare/low-priority statement frames or frames with unsupported role mechanics
    const resultative = frame.act === 'change' && frame.roles?.length === 2 && frame.roles.includes('thing') &&
      frame.parts.some((part) => part.role === 'value' && part.takes === 'lexicon' && part.lexicon === 'value');
    const ellipsisAnchors = resultative && !frame.parts.some((part) => part.is === 'verb' || part.act)
      ? verbVariants.get(frame.name) : null;
    if (frame.priority < 5 && !ellipsisAnchors) continue;
    if (!frame.roles?.some((r) => SUPPORTED_ROLES.has(r))) continue;

    // Only compile frames that have at least one structural anchor (word/verb/lexicon)
    // and at least 2 roles (or 1 role + fixed attribute/thing) so single-role catch-all frames don't explode.
    const roleParts = frame.parts.filter((p) => p.is === 'role');
    if (roleParts.length < 2 && !(roleParts.length === 1 && frame.fixed?.size > 0)) continue;
    const hasAnchor = frame.parts.some(
      (p) => !p.optional && (p.is === 'word' || p.is === 'verb' || (p.is === 'role' && p.takes === 'lexicon')),
    );
    if (!hasAnchor) continue;

    // Pre-split multi-word literal alternatives for fast token matching
    const parts = frame.parts.map((p) => ({
      ...p,
      wordSeqs: (p.words ?? [])
        .map((w) => w.toLowerCase().trim().split(/\s+/).filter(Boolean))
        .filter((s) => s.length > 0)
        .sort((a, b) => b.length - a.length),
    }));
    const contextProperty = frame.act === 'change' && frame.roles?.length === 2 &&
      ['attrs', 'values'].includes(frame.needs) &&
      parts.some((p) => p.role === 'attribute' && p.lexicon === 'attribute') &&
      parts.some((p) => p.role === 'value' && p.takes === 'words');

    // Collect quick-filter anchor tokens from the first required literal/lexicon part
    const reqWordParts = parts.filter((p, index) => !p.optional && p.is === 'word' && p.wordSeqs.length > 0 &&
      !(contextProperty && parts[index - 1]?.role === 'attribute' && parts[index + 1]?.role === 'value'));
    const reqLexParts = parts.filter((p) => !p.optional && p.is === 'role' && p.takes === 'lexicon' && p.lexicon);

    compiled.push({
      name: frame.name,
      act: frame.act,
      mode: VALID_MODE_SET.has(frame.mode) ? frame.mode : (frame.mode === 'layout' ? 'arrange' : 'none'),
      priority: frame.priority,
      sourceShard: frame.sourceShard,
      fixed: frame.fixed ?? new Map(),
      parts,
      reqWordParts,
      reqLexParts,
      ellipsisAnchors,
      contextProperty,
      coordinationAnchor: resultative && coordinationAnchors.has(frame.name),
    });
  }

  compiled.sort((a, b) => b.priority - a.priority || b.parts.length - a.parts.length);
  frameIndexCache.set(kb, compiled);
  return compiled;
}

function matchWordSeqAt(tokens, pos, seq) {
  if (pos + seq.length > tokens.length) return -1;
  for (let j = 0; j < seq.length; j++) {
    if (tokens[pos + j].lower !== seq[j]) return -1;
  }
  return pos + seq.length;
}

function matchLexiconAt(tokens, pos, lexName, kb, tabSpec) {
  const T = tokens.length;
  const maxLen = Math.min(4, T - pos);
  const hits = [];

  if (lexName === 'attribute') {
    const kwIdx = tabSpec?.keyWordIndex;
    if (!kwIdx) return hits;
    for (let len = maxLen; len >= 1; len--) {
      if (tokens.slice(pos, pos + len).some((t) => t.isPunct)) continue;
      const phrase = tokens.slice(pos, pos + len).map((t) => t.lower).join(' ');
      const forms = new Set(singularisePhrase(phrase, kb));
      for (const f of [...forms]) {
        if (f.includes('colour')) forms.add(f.replace(/colour/g, 'color'));
        if (f.includes('color')) forms.add(f.replace(/color/g, 'colour'));
      }
      let matched = false;
      for (const f of forms) {
        if (kwIdx.has(f)) {
          matched = true;
          break;
        }
      }
      if (matched) hits.push(pos + len);
    }
    return hits;
  }

  const lexSet = kb?.grammar?.lexicons?.get(lexName);
  if (!lexSet || lexSet.size === 0) return hits;
  for (let len = maxLen; len >= 1; len--) {
    if (tokens.slice(pos, pos + len).some((t) => t.isPunct)) continue;
    const phrase = tokens.slice(pos, pos + len).map((t) => t.lower).join(' ');
    const forms = singularisePhrase(phrase, kb);
    if (forms.some((f) => lexSet.has(f))) {
      hits.push(pos + len);
    }
  }
  return hits;
}

function matchVerbAt(tokens, pos, reqAct, kb) {
  const tok = tokens[pos];
  if (!tok || tok.kind !== 'word' || tok.isPunct) return [];
  const verbs = kb?.verbs;
  if (!verbs) return [];
  const lemmas = lemmatiseVerb(tok.lower, kb);
  const out = [];
  // 2-token phrasal verb first, then 1-token
  if (pos + 1 < tokens.length && tokens[pos + 1].kind === 'word') {
    const w2 = tokens[pos + 1].lower;
    for (const l of lemmas) {
      const entries = verbs.get?.(`${l} ${w2}`);
      if (entries && entries.some((e) => e.act === reqAct)) {
        out.push(pos + 2);
        break;
      }
    }
  }
  for (const l of lemmas) {
    const entries = verbs.get?.(l);
    if (entries && entries.some((e) => e.act === reqAct)) {
      out.push(pos + 1);
      break;
    }
  }
  return out;
}

export function matchLeadAt(tokens, pos, kb) {
  const fillerPhrases = kb?.grammar?.fillerPhrases;
  const fillerWords = kb?.grammar?.fillerWords;
  const T = tokens.length;
  const out = [];
  for (let len = Math.min(4, T - pos); len >= 1; len--) {
    if (tokens.slice(pos, pos + len).some((t) => t.isPunct && t.text !== ',')) continue;
    const ph = tokens.slice(pos, pos + len).filter((t) => !t.isPunct).map((t) => t.lower).join(' ');
    if ((len > 1 && fillerPhrases?.has(ph)) || (len === 1 && fillerWords?.has(ph))) {
      let nextPos = pos + len;
      if (nextPos < T && tokens[nextPos].text === ',') nextPos++;
      out.push(nextPos);
    }
  }
  return out;
}

function frameWindows(tokens, splitPoints, predicates) {
  const clauses = [];
  let cStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].isPunct && ['.', ';', '?'].includes(tokens[i].text)) {
      if (i > cStart) clauses.push([cStart, i - 1]);
      cStart = i + 1;
    }
  }
  if (cStart < tokens.length) clauses.push([cStart, tokens.length - 1]);

  const predicateStarts = new Set(predicates.map((predicate) => predicate.startTok));
  const cuts = new Map();
  for (const split of splitPoints) {
    if (!predicateStarts.has(split.endTok + 1)) continue;
    const previous = cuts.get(split.endTok);
    if (!previous || split.startTok < previous.startTok) cuts.set(split.endTok, split);
  }
  const windows = clauses.map(([startTok, endTok]) => ({ startTok, endTok }));
  for (const [start, end] of clauses) {
    const localCuts = [...cuts.values()].filter((cut) => cut.startTok > start && cut.endTok < end &&
      predicates.some((predicate) => predicate.startTok >= start && predicate.endTok < cut.startTok))
      .sort((a, b) => a.startTok - b.startTok);
    let left = start;
    const segments = [];
    for (const cut of localCuts) {
      if (cut.startTok <= left) continue;
      segments.push({ startTok: left, endTok: cut.startTok - 1, cut });
      left = cut.endTok + 1;
    }
    if (segments.length === 0) continue;
    segments.push({ startTok: left, endTok: end });
    for (const [i, segment] of segments.entries()) {
      windows.push({ startTok: segment.startTok, endTok: segment.endTok, joinerBounded: true });
      // A weak joiner can be part of a literal property value, even when the
      // word after it has a verb reading. Keep both candidate boundaries.
      for (let j = i - 1; j >= 0; j--) {
        const { startTok, cut } = segments[j];
        if (cut.isStrong || tokens[cut.startTok].isPunct || segment.endTok - startTok + 1 > MAX_FRAME_WINDOW) break;
        if (startTok === start && segment.endTok === end) continue;
        windows.push({ startTok, endTok: segment.endTok, joinerBounded: true,
          internalJoiners: segments.slice(j, i).map((part) => part.cut) });
      }
    }
  }
  return windows;
}

export function findSpatialOwners(tokens, heads, relations, anchors) {
  const selectors = [];
  const grammarGap = (left, right) => tokens.slice(left.endTok + 1, right.startTok).every((token) => token.isGrammar);
  for (const relation of relations) {
    const ownerHeads = heads.filter((head) => head.endTok < relation.startTok && grammarGap(head, relation));
    if (ownerHeads.length === 0) continue;
    for (const anchor of anchors) {
      if (anchor.family === relation.family &&
          anchor.startTok > relation.endTok && anchor.startTok - relation.endTok <= 3 && grammarGap(relation, anchor)) {
        selectors.push({ heads: ownerHeads, relation, anchor });
      }
    }
  }
  return selectors;
}

export function findOwnerSelectors(thing, tokens, heads, relations, anchors) {
  return findSpatialOwners(tokens, heads.filter((head) => head.startTok >= thing.startTok),
    relations.filter((relation) => relation.startTok > thing.startTok && relation.endTok < thing.endTok),
    anchors.filter((anchor) => anchor.endTok === thing.endTok));
}

export function partOwnerInThing(owner, thing) {
  return thing && owner.partHead && owner.partHead[0] >= thing.startTok && owner.partHead[1] <= thing.endTok &&
    owner.startTok >= thing.startTok - 1 && owner.endTok <= thing.endTok;
}

function propertyAttributes(span, kb, tabSpec) {
  const forms = singularisePhrase(span.text.toLowerCase(), kb);
  return new Set(forms.flatMap((form) => [...(tabSpec?.keyWordIndex?.get(form) ?? [])]));
}

function structuredContextKeys(span, tokens, candidates, kb, tabSpec) {
  const det = kb.grammar.determiners?.get(tokens[span?.startTok - 1]?.lower)?.det;
  if (!span || ['indefinite', 'quantified'].includes(det)) return [];
  const matched = [...propertyAttributes(span, kb, tabSpec)].map((name) => tabSpec.keys.get(name)).filter(Boolean);
  const direct = matched.filter((key) => key.literalKeyWords?.has(span.text.toLowerCase()));
  const keys = direct.length ? direct : matched;
  if (keys.some((key) => key.head === 'span') || !keys.some((key) =>
    key.head.startsWith('number') || key.values?.size || key.name === 'meeting.time')) return [];
  const head = candidates.some((c) => [HYP_KINDS.TARGET_SORT, HYP_KINDS.TARGET_FAMILY].includes(c.kind) &&
    c.startTok === span.startTok && c.endTok === span.endTok);
  return head ? [] : keys;
}

export function isStructuredPropertyValue(candidate, key) {
  if (!key || candidate.kind !== HYP_KINDS.CONSTRAINT || candidate.openValue || candidate.isAnchor ||
      candidate.needsAnchor || candidate.pairedConstraints?.length) return false;
  const value = String(candidate.value ?? '').trim();
  return Boolean(value && ((key.head.startsWith('number') && candidate.operator === 'eq' && Number.isFinite(Number(value))) ||
    (['eq', 'degree'].includes(candidate.operator) && key.values?.has(value.toLowerCase()))));
}

function hasExactNumericKey(keys, span) {
  return keys.length > 0 && keys.every((key) => key.head === 'number' && key.literalKeyWords?.has(span.text.toLowerCase()));
}

function contextValues(candidates, keys, span) {
  return candidates.filter((c) => c.startTok === span.startTok && c.endTok === span.endTok &&
    keys.some((key) => key.name === c.attribute && isStructuredPropertyValue(c, key)));
}

function isGroundedPropertyValue(candidate, keys) {
  return isIndependentValueCandidate(candidate) || isStructuredPropertyValue(candidate, keys.get(candidate.attribute));
}

function splitPartProperties(value, connector, attributes, families, tokens, candidates, kb, tabKeys) {
  const values = candidates.filter((c) => families.has(c.family) && isGroundedPropertyValue(c, tabKeys));
  const keywords = candidates.filter((c) => c.kind === HYP_KINDS.KEY_WORD && c.startTok > value.startTok);
  const properties = [];
  let endTok = value.endTok;
  for (let cut = endTok - 1; cut > value.startTok; cut--) {
    if (!kb.grammar.coordinators?.has(tokens[cut].lower)) continue;
    const afterCut = cut + 1;
    const first = kb.grammar.determiners?.get(tokens[afterCut].lower)?.det === 'definite' ? afterCut + 1 : afterCut;
    for (const attrSpan of keywords.filter((c) => c.startTok === first)) {
      const startTok = matchWordSeqAt(tokens, attrSpan.endTok + 1, connector);
      const attrs = values.filter((c) => c.startTok === startTok && c.endTok === endTok &&
        attrSpan.attrs.includes(c.attribute)).map((c) => c.attribute);
      if (attrs.length === 0) continue;
      properties.unshift({ attrSpan, valSpan: { startTok, endTok }, attrs: [...new Set(attrs)] });
      endTok = cut - 1;
      if (tokens[endTok].text === ',') endTok--;
      break;
    }
  }
  const typed = values.some((c) => c.startTok === value.startTok && c.endTok === endTok && attributes.includes(c.attribute));
  const literal = attributes.some((attribute) => {
    const key = tabKeys.get(attribute);
    return key && families.has(key.family) && ['span', 'candidate'].includes(key.head) && !key.values?.size;
  }) && tokens.slice(value.startTok, endTok + 1).some((token) => token.isContent || token.kind === 'quote');
  if (!properties.length || (!typed && !literal)) {
    return { endTok: value.endTok, properties: [] };
  }
  return { endTok, properties };
}

function relativeTimeOperand(keys, tokens, start, end, kb, candidates) {
  const timeKeys = keys.filter((key) => ['page.time', 'meeting.time'].includes(key.name));
  if (!timeKeys.length || !kb.grammar.constructions?.has('pp.time')) return null;
  let grammarPrefix = true;
  for (let first = start; first < end; first++) {
    for (let last = first; last < Math.min(end, first + 3); last++) {
      const phrase = tokens.slice(first, last + 1).map((t) => t.lower).join(' ');
      const prep = kb.grammar.prepositions.get(phrase);
      if (prep?.isTime && ['before', 'after', 'since', 'until', 'between'].includes(prep.rel) &&
          !tokens[last + 1].isPunct) {
        const grounded = candidates.some((c) => c.kind === HYP_KINDS.CONSTRAINT && c.startTok > last && c.endTok === end &&
          !c.openValue && !c.requiresKeyWord && timeKeys.some((key) => key.name === c.attribute));
        // Calendar also has a native meeting-to-meeting relation. Restrict
        // this fallback there to independently identified time-of-day anchors.
        if (grounded || (grammarPrefix && timeKeys.some((key) => key.name === 'page.time'))) return { grounded };
      }
    }
    grammarPrefix &&= tokens[first].isGrammar;
  }
  return null;
}

/**
 * Match declared frames within hard punctuation boundaries. Candidate clause
 * separators also license local windows when they precede a predicate.
 */
export function matchFrames(tokens, text, { tab, kb, tabSpec, splitPoints = [], predicates = [], candidates = [] }) {
  if (!tokens?.length || !kb?.grammar?.frames) return [];
  const compiled = getCompiledFrames(kb);
  if (compiled.length === 0) return [];

  const tokenLowSet = new Set(tokens.map((t) => t.lower));
  const windows = frameWindows(tokens, splitPoints, predicates);
  const relations = candidates.filter((c) => c.needsAnchor);
  const anchors = candidates.filter((c) => c.isAnchor);
  const partOwners = candidates.filter((c) => c.partHead);
  const heads = candidates.filter((c) =>
    [HYP_KINDS.TARGET_FAMILY, HYP_KINDS.TARGET_SORT, HYP_KINDS.TARGET_REF].includes(c.kind));
  const valueEnds = new Map();
  // The grammar's value slot can use typed values already recognised in this tab.
  // Use this evidence for changes with a relational description of the owner.
  const coordinatedWindows = new Map();
  const changePredicates = predicates.filter((predicate) => predicate.licensed?.some((licence) =>
    licence.act === 'change' && ['none', 'set'].includes(licence.mode ?? 'none')));
  for (const cut of splitPoints) {
    if (!kb.grammar.coordinators?.has(cut.text.toLowerCase()) || cut.isStrong) continue;
    for (const window of windows) {
      if (window.internalJoiners || cut.startTok - window.startTok < 3 || window.endTok - cut.endTok < 2 ||
          window.endTok - window.startTok + 1 > MAX_FRAME_WINDOW) continue;
      if (!changePredicates.some((predicate) => predicate.startTok >= window.startTok && predicate.endTok < cut.startTok)) continue;
      const key = `${window.startTok}:${cut.startTok}:${window.endTok}`;
      coordinatedWindows.set(key, [
        { startTok: window.startTok, endTok: cut.startTok - 1, pairKey: key, side: 'first' },
        { startTok: cut.endTok + 1, endTok: window.endTok, pairKey: key, side: 'second' },
      ]);
    }
  }
  const candidateWindows = [...windows, ...[...coordinatedWindows.values()].flat()];
  if ((relations.length > 0 && anchors.length > 0) || coordinatedWindows.size > 0) {
    for (const c of candidates.filter(isIndependentValueCandidate)) {
      if (!valueEnds.has(c.startTok)) valueEnds.set(c.startTok, new Set());
      valueEnds.get(c.startTok).add(c.endTok + 1);
    }
  }

  const rawMatches = [];

  for (const frame of compiled) {
    const mayHaveLiteralValue = frame.act === 'change' && frame.parts.some((part) => part.role === 'attribute') &&
      frame.parts.some((part) => part.role === 'value' && part.takes === 'words');
    // Fast pre-filter: every required literal word part must have at least one alternative whose first word exists in the sentence!
    let preOk = true;
    for (const wp of frame.reqWordParts) {
      if (!wp.wordSeqs.some((seq) => tokenLowSet.has(seq[0]))) {
        preOk = false;
        break;
      }
    }
    if (!preOk) continue;

    for (const window of candidateWindows) {
      if (window.side === 'first' && !frame.coordinationAnchor) continue;
      if (window.side === 'second' && !frame.ellipsisAnchors) continue;
      if (!window.side && frame.priority < 5) continue;
      const { startTok: clStart, endTok: clEnd } = window;
      const clLen = clEnd - clStart + 1;
      if (clLen < (window.side ? 2 : 3) || clLen > MAX_FRAME_WINDOW || (window.internalJoiners && !mayHaveLiteralValue)) continue;

      // Try matching starting at clause start (or after a leading filler/conjunction)
      const startPositions = [clStart];
      if (clStart + 1 <= clEnd && (tokens[clStart].isFiller || ['and', 'then', 'so', 'ok', 'hey', 'next', 'also', 'please'].includes(tokens[clStart].lower))) {
        let p = clStart + 1;
        while (p <= clEnd && (tokens[p].isPunct || tokens[p].isFiller)) p++;
        if (p <= clEnd) startPositions.push(p);
      }

      for (const s0 of startPositions) {
        const parts = frame.parts;
        const P = parts.length;
        let bestInClause = null;
        let steps = 0;

        const dfs = (pIdx, tIdx, roles, wordAnchors, predSpan) => {
          if (++steps > 500) return;
          if (bestInClause && bestInClause.endTok === clEnd) return;
          if (pIdx === P) {
            // Require frame to consume cleanly to clause end (or optional trailing politeness/punct)
            let rem = tIdx;
            while (rem <= clEnd && (tokens[rem].isPunct || tokens[rem].isFiller)) rem++;
            let contextKeys;
            let relativeTime;
            const thing = roles.get('thing');
            const attribute = roles.get('attribute');
            const value = roles.get('value');
            if (mayHaveLiteralValue && thing && attribute && value && partOwners.length) {
              if (partOwners.some((owner) => owner.partHead[0] >= thing.startTok && owner.partHead[1] <= thing.endTok &&
                owner.endTok > thing.endTok && owner.endTok <= value.endTok)) return;
              const families = new Set(partOwners.filter((owner) => partOwnerInThing(owner, thing)).map((owner) => owner.family));
              if (families.size) {
                const attrs = propertyAttributes(attribute, kb, tabSpec);
                const swallowsDirective = splitPoints.some((cut) => cut.startTok > value.startTok && cut.endTok < value.endTok &&
                  predicates.some((p) => p.startTok === cut.endTok + 1) && candidates.some((c) =>
                    c.startTok === value.startTok && c.endTok === cut.startTok - 1 && families.has(c.family) &&
                    attrs.has(c.attribute) && isGroundedPropertyValue(c, tabSpec.keys)));
                if (swallowsDirective) return;
              }
            }
            if (frame.contextProperty) {
              const value = roles.get('value');
              const attribute = roles.get('attribute');
              const keys = structuredContextKeys(attribute, tokens, candidates, kb, tabSpec);
              relativeTime = value && relativeTimeOperand(keys, tokens, value.startTok, value.endTok, kb, candidates);
              if (value && keys.length && (relativeTime || hasExactNumericKey(keys, attribute) || contextValues(candidates, keys, value).length)) {
                if (rem <= clEnd || splitPoints.some((cut) => cut.startTok >= value.startTok && cut.endTok < tIdx &&
                  ((!relativeTime && cut.isStrong) || predicates.some((p) => p.startTok === cut.endTok + 1)))) return;
                contextKeys = keys;
              }
            }
            if (window.side && (rem <= clEnd || !roles.get('value')?.groundedValue)) return;
            if (window.side === 'first' && !changePredicates.some((predicate) =>
              predicate.startTok === predSpan?.startTok && predicate.endTok === predSpan?.endTok)) return;
            if (window.internalJoiners) {
              const value = roles.get('value');
              const attribute = roles.get('attribute');
              if (rem <= clEnd || !value || !attribute || !roles.has('thing') ||
                  window.internalJoiners.some((cut) => cut.startTok <= value.startTok || cut.endTok >= value.endTok) ||
                  ![...propertyAttributes(attribute, kb, tabSpec)].some((key) => tabSpec.keys.get(key)?.head === 'span')) return;
            }
            if (rem > clEnd || (clEnd - tIdx) <= 2) {
              const candEnd = Math.min(clEnd, Math.max(s0, tIdx - 1));
              if (!bestInClause || candEnd > bestInClause.endTok) {
                bestInClause = {
                  startTok: s0,
                  endTok: candEnd,
                  roles: new Map(roles),
                  wordAnchors: [...wordAnchors],
                  predSpan,
                  contextKeys,
                  relativeTime,
                };
              }
            }
            return;
          }
          if (tIdx > clEnd + 1) return;

          const part = parts[pIdx];

          if (part.is === 'lead') {
            for (const nxt of matchLeadAt(tokens, tIdx, kb)) {
              if (nxt <= clEnd + 1) dfs(pIdx + 1, nxt, roles, wordAnchors, predSpan);
            }
            if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            return;
          }

          if (part.is === 'det') {
            if (tIdx <= clEnd && DET_WORDS.has(tokens[tIdx].lower)) {
              dfs(pIdx + 1, tIdx + 1, roles, wordAnchors, predSpan);
            }
            if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            return;
          }

          if (part.is === 'verb') {
            const reqAct = part.act || frame.act;
            for (const nxt of matchVerbAt(tokens, tIdx, reqAct, kb)) {
              if (nxt <= clEnd + 1) {
                dfs(pIdx + 1, nxt, roles, wordAnchors, { startTok: tIdx, endTok: nxt - 1 });
              }
            }
            if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            return;
          }

          if (part.is === 'word') {
            let boundValueConnector = false;
            for (const seq of part.wordSeqs) {
              const nxt = matchWordSeqAt(tokens, tIdx, seq);
              if (nxt > 0 && nxt <= clEnd + 1) {
                const nextPred = part.act ? { startTok: tIdx, endTok: nxt - 1 } : predSpan;
                const nextPart = parts.slice(pIdx + 1).find((p) => p.is !== 'det');
                if (mayHaveLiteralValue && parts[pIdx - 1]?.role === 'thing' && nextPart?.role === 'value' &&
                    roles.has('attribute') && partOwners.some((owner) => partOwnerInThing(owner, roles.get('thing')))) {
                  boundValueConnector = true;
                }
                const nextAnchors = [...wordAnchors, {
                  text: seq.join(' '), startTok: tIdx, endTok: nxt - 1,
                  partAt: part.at,
                  afterRole: parts[pIdx - 1]?.role,
                  beforeRole: nextPart?.role,
                }];
                dfs(pIdx + 1, nxt, roles, nextAnchors, nextPred);
              }
            }
            // A canonical time phrase can directly follow an explicit time
            // property. Keep the relative scope without supplying a missing connector.
            if (frame.contextProperty && parts[pIdx - 1]?.role === 'attribute' && parts[pIdx + 1]?.role === 'value' &&
                relativeTimeOperand(structuredContextKeys(roles.get('attribute'), tokens, candidates, kb, tabSpec),
                  tokens, tIdx, clEnd, kb, candidates)) {
              dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            }
            if (part.optional && !boundValueConnector) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            return;
          }

          if (part.is === 'role') {
            if (part.takes === 'lexicon') {
              let ends = matchLexiconAt(tokens, tIdx, part.lexicon, kb, tabSpec);
              const thing = roles.get('thing');
              const coordinatedValue = window.side && thing && part.role === 'value' && part.lexicon === 'value' &&
                tokens.slice(thing.startTok, thing.endTok + 1).every((token) => !kb.grammar.prepositions.has(token.lower)) &&
                heads.some((head) => head.kind !== HYP_KINDS.TARGET_REF && head.family &&
                  head.startTok === thing.startTok && head.endTok === thing.endTok);
              const localValues = frame.act === 'change' && part.role === 'value' && part.lexicon === 'value' &&
                thing && !roles.has('attribute') && valueEnds.has(tIdx) &&
                (window.side ? coordinatedValue : findOwnerSelectors(thing, tokens, heads, relations, anchors).length > 0)
                ? valueEnds.get(tIdx)
                : null;
              if (localValues) {
                ends = [...new Set([...ends, ...localValues])].sort((a, b) => b - a);
              }
              for (const nxt of ends) {
                if (nxt <= clEnd + 1) {
                  const nextRoles = new Map(roles);
                  nextRoles.set(part.role, {
                    startTok: tIdx,
                    endTok: nxt - 1,
                    text: text.slice(tokens[tIdx].start, tokens[nxt - 1].end),
                    lexicon: part.lexicon,
                    describedOwner: !window.side && (localValues?.has(nxt) ?? false),
                    groundedValue: localValues?.has(nxt) ?? false,
                  });
                  dfs(pIdx + 1, nxt, nextRoles, wordAnchors, predSpan);
                }
              }
              if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
              return;
            }

            if (part.takes === 'prep') {
              if (tIdx <= clEnd && kb?.grammar?.prepositions?.has(tokens[tIdx].lower)) {
                const nextRoles = new Map(roles);
                nextRoles.set(part.role, {
                  startTok: tIdx,
                  endTok: tIdx,
                  text: tokens[tIdx].text,
                });
                dfs(pIdx + 1, tIdx + 1, nextRoles, wordAnchors, predSpan);
              }
              if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
              return;
            }

            // `takes === 'words'` (open role span, bounded by maxWords or 5 tokens, never crossing comma/punct)
            const maxW = part.maxWords ?? (pIdx === P - 1 ? 6 : 4);
            let maxEnd = Math.min(clEnd, tIdx + maxW - 1);
            if (part.role === 'thing' && mayHaveLiteralValue && roles.has('attribute')) {
              for (const owner of partOwners) {
                if (owner.partHead[0] >= tIdx && owner.partHead[1] <= maxEnd && owner.endTok <= clEnd) {
                  maxEnd = Math.max(maxEnd, owner.endTok);
                }
              }
            }
            // If this is the last required part, prefer longer spans; otherwise try shortest-first to hit next anchor cleanly
            const lengths = [];
            for (let end = tIdx; end <= maxEnd; end++) {
              if (tokens[end].isPunct && end > tIdx) break;
              if (tokens[end].isPunct && end === tIdx) break;
              lengths.push(end);
            }
            if (part.role === 'value' && mayHaveLiteralValue && roles.has('thing') && roles.has('attribute')) {
              const connector = wordAnchors.find((word) => word.afterRole === 'thing' && word.beforeRole === 'value');
              const families = new Set(partOwners.filter((owner) => partOwnerInThing(owner, roles.get('thing'))).map((owner) => owner.family));
              let last = clEnd;
              while (last > tIdx && (tokens[last].isPunct || tokens[last].isFiller)) last--;
              if (connector && families.size && last > (lengths.at(-1) ?? tIdx)) {
                const attributes = [...propertyAttributes(roles.get('attribute'), kb, tabSpec)];
                const split = splitPartProperties({ startTok: tIdx, endTok: last }, connector.text.split(' '), attributes,
                  families, tokens, candidates, kb, tabSpec.keys);
                if (split.properties.length) lengths.push(last);
              }
            }
            if (pIdx === P - 1) lengths.reverse();
            for (const end of lengths) {
              const nextRoles = new Map(roles);
              nextRoles.set(part.role, {
                startTok: tIdx,
                endTok: end,
                text: text.slice(tokens[tIdx].start, tokens[end].end),
              });
              dfs(pIdx + 1, end + 1, nextRoles, wordAnchors, predSpan);
            }
            if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
          }
        };

        dfs(0, s0, new Map(), [], null);
        if (bestInClause) {
          rawMatches.push({
            frameName: frame.name,
            act: frame.act,
            mode: frame.mode,
            priority: frame.priority,
            sourceShard: frame.sourceShard,
            fixed: frame.fixed,
            clauseWindow: window.joinerBounded ? window : null,
            coordination: window.side ? window : null,
            ellipsisAnchors: frame.ellipsisAnchors,
            ...bestInClause,
          });
          break; // one match per frame per clause
        }
      }
    }
  }

  // Reserve a ranked match for each observed clause start before filling the remaining budget.
  rawMatches.sort((a, b) => b.priority - a.priority || (b.endTok - b.startTok) - (a.endTok - a.startTok));
  const seen = new Set();
  const bestByStart = new Map();
  const alternatives = [];
  const coordinated = [];
  const context = [];
  for (const m of rawMatches) {
    if (m.coordination) {
      coordinated.push(m);
      continue;
    }
    const scope = m.clauseWindow;
    const key = `${m.frameName}:${m.startTok}:${m.endTok}:${scope?.startTok ?? ''}:${scope?.endTok ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (m.contextKeys) context.push(m);
    if (bestByStart.has(m.startTok)) alternatives.push(m);
    else bestByStart.set(m.startTok, m);
  }
  const ranked = [...bestByStart.values(), ...alternatives].slice(0, 6);
  return [...new Set([...ranked, ...context]), ...coordinated].map((m, id) => ({ id, ...m }));
}

export function pairResultativeFrames(matches) {
  const firstMatches = matches.filter((match) => match.coordination?.side === 'first' && match.predSpan);
  const pairs = new Map();
  for (const second of matches.filter((match) => match.coordination?.side === 'second')) {
    for (const first of firstMatches) {
      if (first.coordination.pairKey !== second.coordination.pairKey ||
          !second.ellipsisAnchors.has(first.frameName)) continue;
      const parts = [first, second].map((match) => ({
        startTok: match.startTok, endTok: match.endTok, predicate: match.predSpan?.startTok ?? -1,
        thing: match.roles.get('thing'), value: match.roles.get('value'),
      }));
      const key = JSON.stringify(parts);
      if (!pairs.has(key)) pairs.set(key, parts);
    }
  }
  return [...pairs.values()];
}

/**
 * Enrich lattice candidates with grounded argument-structure hypotheses from matched `w.lang.en.frame` instances
 * and attach explicit candidate-ID bindings so `src/smt/encode.mjs` can encode Z3 frame-attachment laws!
 */
export function applyFrameMatchesToLattice(frameMatches, { tokens, text, tab, kb, tabSpec, candidates, emit, emitConstraint, parseNumeric }) {
  if (!frameMatches?.length) return [];

  const tabKeys = tabSpec?.keys ?? new Map();
  const tabFamilies = tabSpec?.families ?? [];
  const enriched = [];

  for (const fm of frameMatches) {
    if (fm.coordination) continue;
    const blockedSpatialToks = new Set();
    const blockedEndpointToks = new Set();
    const expectedAttrs = new Set();
    const numericPropertyFamilies = new Set();
    const requiredCandGroups = []; // each group is an array of candidate IDs (at least one must be selected if frame active)
    const forceResultCandIds = new Set();
    const forceSelectorCandIds = new Set();

    const attrSpan = fm.roles.get('attribute');
    const thingSpan = fm.roles.get('thing');
    const valSpan = fm.roles.get('value');
    let resultSpan = valSpan;
    let additionalProperties = [];
    let unresolvedDuration = null;
    let contextProperty = null;
    const oldSpan = fm.roles.get('old');
    const topicSpan = fm.roles.get('topic');
    const wholeSpan = fm.roles.get('whole');
    const critSpan = fm.roles.get('criterion');
    const endsSpan = fm.roles.get('ends');
    const arrSpan = fm.roles.get('arrangement');
    const relSpan = fm.roles.get('rel');
    const matSpan = fm.roles.get('material');
    const replSpan = fm.roles.get('replacement');
    const propertyOwnerMarker = attrSpan && thingSpan && valSpan
      ? fm.wordAnchors.find((wa) => wa.afterRole === 'attribute' && wa.beforeRole === 'thing')
      : null;
    const describedOwner = Boolean(valSpan?.describedOwner && !attrSpan);

    if (fm.contextKeys) {
      const keys = fm.contextKeys;
      const families = [...new Set(keys.map((key) => key.family))];
      const token = tokens[valSpan.startTok];
      if (valSpan.startTok === valSpan.endTok && token.kind === 'quote') {
        const inner = tokenize(token.inner, kb);
        const scalar = inner.length === 1 && inner[0].kind === 'number' ? parseNumeric?.(inner[0]) : null;
        if (scalar != null) {
          for (const key of keys.filter((key) => key.head.startsWith('number'))) {
            emitConstraint(key.name, String(scalar), valSpan.startTok, valSpan.endTok, { phase: 'result', requiresKeyWord: true, cost: 1 });
          }
        }
      }
      const valid = fm.relativeTime ? [] : contextValues(candidates, keys, valSpan);
      for (const c of valid) expectedAttrs.add(c.attribute);
      const unresolved = valid.length ? null : { startTok: attrSpan.startTok, endTok: valSpan.endTok };
      if (unresolved) emit({ kind: HYP_KINDS.UNREAD, ...unresolved, propertyQualifier: true,
        note: fm.relativeTime ? 'pp.time' : fm.frameName, requiredRelativeTime: Boolean(fm.relativeTime), cost: 9 });
      const beforeAttribute = attrSpan.startTok - 1;
      const determiner = tokens[beforeAttribute];
      const ownerToken = beforeAttribute >= fm.startTok && determiner?.kind === 'word' &&
        kb.grammar.determiners?.get(determiner.lower)?.kind === 'possessive' ? beforeAttribute : null;
      if (ownerToken !== null) {
        emit({ kind: HYP_KINDS.TARGET_REF, startTok: ownerToken, endTok: ownerToken,
          isPronoun: true, isPropertyOwner: true, fill: 'context', det: 'possessive', families, cost: 3 });
      }
      contextProperty = { families, ownerToken, unresolved, groundedRelativeTime: fm.relativeTime?.grounded ?? false };
    }

    // 1. Property-owner-value frame (`acts.change.property.on`: "Set the width on the node to 15",
    //    `acts.ask.property.have`: "What width does the node have?"):
    //    The matched part between attribute and thing introduces the owner.
    //    The part between thing and value introduces the result, not a link endpoint.
    if (attrSpan && thingSpan) {
      for (const wa of fm.wordAnchors) {
        if (valSpan && wa.afterRole === 'thing' && wa.beforeRole === 'value') {
          for (let t = wa.startTok; t <= valSpan.endTok; t++) blockedEndpointToks.add(t);
        }
      }
      // Find attributes matching attrSpan in tabSpec.keyWordIndex
      const matchedAttrs = [...propertyAttributes(attrSpan, kb, tabSpec)].filter((attr) => {
        const key = tabKeys.get(attr);
        return key && (!fm.clauseWindow?.internalJoiners || key.head === 'span');
      });
      if (valSpan && matchedAttrs.length > 0) {
        const partFamilies = new Set(candidates.filter((c) => partOwnerInThing(c, thingSpan)).map((c) => c.family));
        const connector = fm.wordAnchors.find((word) => word.afterRole === 'thing' && word.beforeRole === 'value');
        if (propertyOwnerMarker && partFamilies.size && connector) {
          const split = splitPartProperties(valSpan, connector.text.split(' '), matchedAttrs, partFamilies, tokens, candidates, kb, tabKeys);
          additionalProperties = split.properties;
          if (split.endTok !== valSpan.endTok) {
            resultSpan = { ...valSpan, endTok: split.endTok, text: text.slice(tokens[valSpan.startTok].start, tokens[split.endTok].end) };
          }
        }
        const surface = attrSpan.text.toLowerCase();
        for (const attr of matchedAttrs) {
          const key = tabKeys.get(attr);
          if (key.head === 'number' && key.literalKeyWords?.has(surface)) numericPropertyFamilies.add(key.family);
        }
        if (propertyOwnerMarker && numericPropertyFamilies.size > 0) {
          // A duration following a complete numeric property value qualifies the
          // change. The request schema has no slot for this duration.
          const duration = candidates.find((c) => c.measure != null && ['second', 'minute', 'hour'].includes(c.unit) &&
            c.startTok > valSpan.startTok + 1 && c.endTok === valSpan.endTok && tokens[c.startTok - 1].lower === 'for');
          if (duration) {
            const endTok = duration.startTok - 2;
            const hasValue = candidates.some((c) => matchedAttrs.includes(c.attribute) &&
              numericPropertyFamilies.has(c.family) && c.startTok === valSpan.startTok && c.endTok === endTok &&
              c.value.trim() !== '' && Number.isFinite(Number(c.value)) && !c.pairedConstraints?.length);
            if (hasValue) {
              resultSpan = {
                startTok: valSpan.startTok,
                endTok,
                text: text.slice(tokens[valSpan.startTok].start, tokens[endTok].end),
              };
              unresolvedDuration = { startTok: duration.startTok - 1, endTok: duration.endTok };
              emit({ kind: HYP_KINDS.UNREAD, ...unresolvedDuration, propertyQualifier: true, cost: 8 });
            }
          }
        }
        // Ordinary numbers and measures already have structured lattice candidates.
        // A quoted scalar is numeric here only when the complete inner text is one number.
        const quoted = resultSpan.startTok === resultSpan.endTok ? tokens[resultSpan.startTok] : null;
        const inner = quoted?.kind === 'quote' ? tokenize(quoted.inner, kb) : [];
        const quotedNumber = inner.length === 1 && inner[0].kind === 'number' ? parseNumeric?.(inner[0]) : null;
        for (const attr of matchedAttrs) {
          expectedAttrs.add(attr);
          const key = tabKeys.get(attr);
          const numeric = key.head === 'number' || numericPropertyFamilies.has(key.family);
          if (numeric && quotedNumber == null) continue;
          let value = resultSpan.text;
          if (numeric) value = String(quotedNumber);
          else if (key.head === 'span' && quoted?.kind === 'quote') value = quoted.inner;
          emitConstraint(attr, value, resultSpan.startTok, resultSpan.endTok, {
            phase: 'result',
            requiresKeyWord: true,
            allowOpen: true,
            cost: 1.0,
          });
        }
      }
      // Ensure owner span has a grounded TARGET_REF if no sort/family/ref already covers it
      const hasOwnerCand = candidates.some(
        (c) =>
          (c.kind === HYP_KINDS.TARGET_REF || c.kind === HYP_KINDS.TARGET_SORT || c.kind === HYP_KINDS.TARGET_FAMILY) &&
          c.startTok >= thingSpan.startTok &&
          c.endTok <= thingSpan.endTok,
      );
      if (!hasOwnerCand && thingSpan.text && !DET_WORDS.has(thingSpan.text.toLowerCase())) {
        emit({
          kind: HYP_KINDS.TARGET_REF,
          startTok: thingSpan.startTok,
          endTok: thingSpan.endTok,
          fill: 'written',
          name: thingSpan.text,
          isProper: true,
          det: 'definite',
          detTok: -1,
          families: tabFamilies,
          cost: 2.5,
        });
      }
    }

    // 2. Old -> new transition (`acts.change.from`: "Change the car from red to blue")
    if (oldSpan && valSpan) {
      for (const wa of fm.wordAnchors) {
        if (['from', 'to', 'into'].includes(wa.text)) {
          for (let t = wa.startTok; t <= valSpan.endTok; t++) blockedEndpointToks.add(t);
        }
      }
    }

    // 3. Diagram kind + topic + criterion (`diagram-frames.sop`: "Make a flowchart of making tea", "Draw the planets on a timeline")
    if (tab === 'diagram' && topicSpan && thingSpan?.lexicon?.startsWith('diagram.kind')) {
      for (const wa of fm.wordAnchors) {
        if (['on', 'in', 'onto', 'into', 'as'].includes(wa.text)) {
          for (let t = wa.startTok; t <= thingSpan.endTok; t++) blockedSpatialToks.add(t);
        }
      }
      const topicEnd = wholeSpan ? wholeSpan.endTok : topicSpan.endTok;
      const topicText = text.slice(tokens[topicSpan.startTok].start, tokens[topicEnd].end);
      if (tabKeys.has('diagram.about') && topicText) {
        emitConstraint('diagram.about', topicText, topicSpan.startTok, topicEnd, { phase: 'result', cost: 1.2 });
      }
      if (critSpan && tabKeys.has('diagram.by')) {
        emitConstraint('diagram.by', critSpan.text, critSpan.startTok, critSpan.endTok, { phase: 'result', cost: 1.2 });
      }
    }

    // 4. Edge-label frames (`acts.change.label.edge.ends`: "Label the arrow from A to B no", `acts.change.label.edge`: "Call the arrow yes")
    if (tab === 'diagram' && fm.fixed.get('attribute') === 'label' && valSpan && tabKeys.has('link.label')) {
      emitConstraint('link.label', valSpan.text, valSpan.startTok, valSpan.endTok, {
        phase: 'result',
        allowOpen: true,
        cost: 0.8,
      });
      if (endsSpan) {
        // Parse "<from> to/and <to>" inside endsSpan
        const eToks = tokens.slice(endsSpan.startTok, endsSpan.endTok + 1);
        const sepIdx = eToks.findIndex((t) => t.lower === 'to' || t.lower === 'and');
        if (sepIdx > 0 && sepIdx < eToks.length - 1) {
          const fromEnd = endsSpan.startTok + sepIdx - 1;
          const toStart = endsSpan.startTok + sepIdx + 1;
          const fromText = text.slice(tokens[endsSpan.startTok].start, tokens[fromEnd].end);
          const toText = text.slice(tokens[toStart].start, tokens[endsSpan.endTok].end);
          if (tabKeys.has('link.from')) emitConstraint('link.from', fromText, endsSpan.startTok, fromEnd, { phase: 'selector', cost: 1.0 });
          if (tabKeys.has('link.to')) emitConstraint('link.to', toText, toStart, endsSpan.endTok, { phase: 'selector', cost: 1.0 });
        }
      }
    }

    // 5. Layout-direction frames (`diagram-frames.sop`: "Make the arrows go left to right")
    if (relSpan?.lexicon === 'diagram.direction') {
      const low = relSpan.text.toLowerCase();
      const dirVal = /bottom to top|upward/.test(low)
        ? 'bottom_up'
        : /top to bottom|downward|vertical|down the page|above|below|under/.test(low)
          ? 'top_down'
          : /right to left/.test(low)
            ? 'right_left'
            : 'left_right';
      if (tabKeys.has('diagram.direction')) {
        emitConstraint('diagram.direction', dirVal, relSpan.startTok, relSpan.endTok, { phase: 'result', allowOpen: true, cost: 1.0 });
      }
      if (tabKeys.has('node.axis')) {
        const axisVal = (dirVal === 'top_down' || dirVal === 'bottom_up') ? 'vertical' : 'horizontal';
        emitConstraint('node.axis', axisVal, relSpan.startTok, relSpan.endTok, { phase: 'result', cost: 1.2 });
      }
    }

    // 6. Shape-arrangement frames (`shape-frames.sop`: "Make a diagram in the shape of a house", "Lay the boxes out star-shaped")
    if (arrSpan?.lexicon?.startsWith('outline.')) {
      for (const wa of fm.wordAnchors) {
        if (wa.text.includes('shape') || wa.text.includes('form') || wa.text === 'in' || wa.text === 'as' || wa.text === 'of') {
          for (let t = wa.startTok; t <= arrSpan.endTok; t++) blockedSpatialToks.add(t);
        }
      }
      const shapeVal = arrSpan.text.toLowerCase().replace(/[\s-]+shaped$/, '').trim();
      for (const attr of ['drawn.arrangement', 'diagram.layout', 'node.layout']) {
        if (tabKeys.has(attr)) {
          expectedAttrs.add(attr);
          emitConstraint(attr, shapeVal, arrSpan.startTok, arrSpan.endTok, { phase: 'result', allowOpen: true, cost: 0.6 });
        }
      }
    }

    // 7. Material & replacement frames (`role-frames.sop`: "Make a boat out of paper", "Replace the hat with a crown")
    if (matSpan && tabKeys.has('drawn.material')) {
      for (const wa of fm.wordAnchors) {
        for (let t = wa.startTok; t <= matSpan.endTok; t++) blockedSpatialToks.add(t);
      }
      expectedAttrs.add('drawn.material');
      emitConstraint('drawn.material', matSpan.text.toLowerCase(), matSpan.startTok, matSpan.endTok, { phase: 'result', allowOpen: true, cost: 1.2 });
    }
    if (replSpan) {
      if (tabKeys.has('drawn.kind')) emitConstraint('drawn.kind', replSpan.text.toLowerCase(), replSpan.startTok, replSpan.endTok, { phase: 'result', allowOpen: true, cost: 1.2 });
      if (tabKeys.has('part.variant')) emitConstraint('part.variant', replSpan.text.toLowerCase(), replSpan.startTok, replSpan.endTok, { phase: 'result', allowOpen: true, cost: 1.5 });
    }

    // Only emit Z3 frame constraints for structurally informative argument-structure frames
    // (skip generic 1-role <verb> <thing> frames from frames-acts.sop that carry no argument-attachment structure).
    const hasArgumentStructure =
      describedOwner ||
      blockedSpatialToks.size > 0 ||
      blockedEndpointToks.size > 0 ||
      Boolean(attrSpan || oldSpan || topicSpan || wholeSpan || critSpan || endsSpan || arrSpan || matSpan || replSpan);
    if (!hasArgumentStructure) continue;

    enriched.push({
      id: enriched.length,
      frameName: fm.frameName,
      act: fm.act,
      mode: fm.mode,
      priority: fm.priority,
      startTok: fm.startTok,
      endTok: fm.endTok,
      clauseWindow: fm.clauseWindow,
      propertyOwnerMarker,
      additionalProperties,
      describedOwner,
      unresolvedDuration,
      contextProperty,
      blockedSpatialToks: [...blockedSpatialToks],
      blockedEndpointToks: [...blockedEndpointToks],
      oldSpan: oldSpan ? { startTok: oldSpan.startTok, endTok: oldSpan.endTok } : null,
      valSpan: resultSpan ? { startTok: resultSpan.startTok, endTok: resultSpan.endTok } : (arrSpan ? { startTok: arrSpan.startTok, endTok: arrSpan.endTok } : null),
      attrSpan: attrSpan ? { startTok: attrSpan.startTok, endTok: attrSpan.endTok } : null,
      thingSpan: thingSpan ? { startTok: thingSpan.startTok, endTok: thingSpan.endTok } : null,
      endsSpan: endsSpan ? { startTok: endsSpan.startTok, endTok: endsSpan.endTok } : null,
      expectedAttrs: [...expectedAttrs],
      numericPropertyFamilies: [...numericPropertyFamilies],
      requiredCandGroups,
      forceResultCandIds: [...forceResultCandIds],
      forceSelectorCandIds: [...forceSelectorCandIds],
    });
  }

  return enriched;
}
