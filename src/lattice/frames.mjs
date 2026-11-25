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
  for (const frame of kb.grammar.frames.values()) {
    if (!frame?.parts?.length) continue;
    if (!frame.act || !VALID_ACT_SET.has(frame.act)) continue;
    // Skip bare/low-priority statement frames or frames with unsupported role mechanics
    if (frame.priority < 5) continue;
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

    // Collect quick-filter anchor tokens from the first required literal/lexicon part
    const reqWordParts = parts.filter((p) => !p.optional && p.is === 'word' && p.wordSeqs.length > 0);
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

function matchLeadAt(tokens, pos, kb) {
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
      predicates.some((predicate) => predicate.startTok >= start && predicate.endTok < cut.startTok));
    let left = start;
    for (const cut of localCuts.sort((a, b) => a.startTok - b.startTok)) {
      if (cut.startTok <= left) continue;
      windows.push({ startTok: left, endTok: cut.startTok - 1, joinerBounded: true });
      left = cut.endTok + 1;
    }
    if (left > start) windows.push({ startTok: left, endTok: end, joinerBounded: true });
  }
  return windows;
}

export function findOwnerSelectors(thing, tokens, heads, relations, anchors) {
  const selectors = [];
  const grammarGap = (left, right) => tokens.slice(left.endTok + 1, right.startTok).every((token) => token.isGrammar);
  for (const relation of relations) {
    if (relation.startTok <= thing.startTok || relation.endTok >= thing.endTok) continue;
    const ownerHeads = heads.filter((head) => head.startTok >= thing.startTok &&
      head.endTok < relation.startTok && grammarGap(head, relation));
    if (ownerHeads.length === 0) continue;
    for (const anchor of anchors) {
      if (anchor.family === relation.family && anchor.endTok === thing.endTok &&
          anchor.startTok > relation.endTok && anchor.startTok - relation.endTok <= 3 && grammarGap(relation, anchor)) {
        selectors.push({ heads: ownerHeads, relation, anchor });
      }
    }
  }
  return selectors;
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
  const heads = candidates.filter((c) =>
    [HYP_KINDS.TARGET_FAMILY, HYP_KINDS.TARGET_SORT, HYP_KINDS.TARGET_REF].includes(c.kind));
  const valueEnds = new Map();
  // The grammar's value slot can use typed values already recognised in this tab.
  // Use this evidence for changes with a relational description of the owner.
  if (relations.length > 0 && anchors.length > 0) {
    for (const c of candidates.filter(isIndependentValueCandidate)) {
      if (!valueEnds.has(c.startTok)) valueEnds.set(c.startTok, new Set());
      valueEnds.get(c.startTok).add(c.endTok + 1);
    }
  }

  const rawMatches = [];

  for (const frame of compiled) {
    // Fast pre-filter: every required literal word part must have at least one alternative whose first word exists in the sentence!
    let preOk = true;
    for (const wp of frame.reqWordParts) {
      if (!wp.wordSeqs.some((seq) => tokenLowSet.has(seq[0]))) {
        preOk = false;
        break;
      }
    }
    if (!preOk) continue;

    for (const window of windows) {
      const { startTok: clStart, endTok: clEnd } = window;
      const clLen = clEnd - clStart + 1;
      if (clLen < 3 || clLen > 28) continue;

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
            if (rem > clEnd || (clEnd - tIdx) <= 2) {
              const candEnd = Math.min(clEnd, Math.max(s0, tIdx - 1));
              if (!bestInClause || candEnd > bestInClause.endTok) {
                bestInClause = {
                  startTok: s0,
                  endTok: candEnd,
                  roles: new Map(roles),
                  wordAnchors: [...wordAnchors],
                  predSpan,
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
            for (const seq of part.wordSeqs) {
              const nxt = matchWordSeqAt(tokens, tIdx, seq);
              if (nxt > 0 && nxt <= clEnd + 1) {
                const nextPred = part.act ? { startTok: tIdx, endTok: nxt - 1 } : predSpan;
                const nextPart = parts.slice(pIdx + 1).find((p) => p.is !== 'det');
                const nextAnchors = [...wordAnchors, {
                  text: seq.join(' '), startTok: tIdx, endTok: nxt - 1,
                  partAt: part.at,
                  afterRole: parts[pIdx - 1]?.role,
                  beforeRole: nextPart?.role,
                }];
                dfs(pIdx + 1, nxt, roles, nextAnchors, nextPred);
              }
            }
            if (part.optional) dfs(pIdx + 1, tIdx, roles, wordAnchors, predSpan);
            return;
          }

          if (part.is === 'role') {
            if (part.takes === 'lexicon') {
              let ends = matchLexiconAt(tokens, tIdx, part.lexicon, kb, tabSpec);
              const thing = roles.get('thing');
              const localValues = frame.act === 'change' && part.role === 'value' && part.lexicon === 'value' &&
                thing && !roles.has('attribute') && valueEnds.has(tIdx) &&
                findOwnerSelectors(thing, tokens, heads, relations, anchors).length > 0
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
                    describedOwner: localValues?.has(nxt) ?? false,
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
            const maxEnd = Math.min(clEnd, tIdx + maxW - 1);
            // If this is the last required part, prefer longer spans; otherwise try shortest-first to hit next anchor cleanly
            const lengths = [];
            for (let end = tIdx; end <= maxEnd; end++) {
              if (tokens[end].isPunct && end > tIdx) break;
              if (tokens[end].isPunct && end === tIdx) break;
              lengths.push(end);
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
  for (const m of rawMatches) {
    const scope = m.clauseWindow;
    const key = `${m.frameName}:${m.startTok}:${m.endTok}:${scope?.startTok ?? ''}:${scope?.endTok ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (bestByStart.has(m.startTok)) alternatives.push(m);
    else bestByStart.set(m.startTok, m);
  }
  return [...bestByStart.values(), ...alternatives].slice(0, 6).map((m, id) => ({ id, ...m }));
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
      const matchedAttrs = new Set();
      const attrForms = singularisePhrase(attrSpan.text.toLowerCase(), kb);
      for (const f of attrForms) {
        for (const a of tabSpec?.keyWordIndex?.get(f) ?? []) {
          if (tabKeys.has(a)) matchedAttrs.add(a);
        }
      }
      if (valSpan && matchedAttrs.size > 0) {
        const surface = attrSpan.text.toLowerCase();
        for (const attr of matchedAttrs) {
          const key = tabKeys.get(attr);
          if (key.head === 'number' && key.literalKeyWords?.has(surface)) numericPropertyFamilies.add(key.family);
        }
        // Ordinary numbers and measures already have structured lattice candidates.
        // A quoted scalar is numeric here only when the complete inner text is one number.
        const quoted = valSpan.startTok === valSpan.endTok ? tokens[valSpan.startTok] : null;
        const inner = quoted?.kind === 'quote' ? tokenize(quoted.inner, kb) : [];
        const quotedNumber = inner.length === 1 && inner[0].kind === 'number' ? parseNumeric?.(inner[0]) : null;
        for (const attr of matchedAttrs) {
          expectedAttrs.add(attr);
          const key = tabKeys.get(attr);
          const numeric = key.head === 'number' || numericPropertyFamilies.has(key.family);
          if (numeric && quotedNumber == null) continue;
          emitConstraint(attr, numeric ? String(quotedNumber) : valSpan.text, valSpan.startTok, valSpan.endTok, {
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
      describedOwner,
      blockedSpatialToks: [...blockedSpatialToks],
      blockedEndpointToks: [...blockedEndpointToks],
      oldSpan: oldSpan ? { startTok: oldSpan.startTok, endTok: oldSpan.endTok } : null,
      valSpan: valSpan ? { startTok: valSpan.startTok, endTok: valSpan.endTok } : (arrSpan ? { startTok: arrSpan.startTok, endTok: arrSpan.endTok } : null),
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
