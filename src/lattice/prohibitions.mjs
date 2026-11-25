import { lemmatiseVerb } from './morph.mjs';
import { matchLeadAt } from './frames.mjs';

const SENTENCE_END = new Set([';', '.', '!', '?']);
const INDEPENDENT_JOINERS = new Set(['sequence', 'contrast', 'addition', 'clause']);

function afterFiller(tokens, index) {
  while (tokens[index]?.isFiller && !tokens[index].isPunct) index++;
  return index;
}

function directiveAt(tokens, index, kb, requireBaseForm) {
  return [afterFiller(tokens, index), ...matchLeadAt(tokens, index, kb)].some((start) => {
    const token = tokens[start];
    if (token?.kind !== 'word') return false;
    const next = tokens[start + 1];
    if (requireBaseForm && (!next || next.isPunct || kb.grammar.joiners?.has(next.lower))) return false;
    const verbs = requireBaseForm ? [token.lower] : lemmatiseVerb(token.lower, kb);
    return verbs.some((verb) =>
      kb.verbs.get(verb)?.some(({ act }) => !['greet', 'thank', 'farewell'].includes(act)) ||
      kb.verbs.has(`${verb} ${next?.lower}`));
  });
}

export function findDirectiveProhibitions(tokens, kb) {
  const grammar = kb?.grammar;
  const leads = grammar?.negativeImperative?.leads ?? [];
  if (!leads.some(([first]) => tokens.some((token) => token.lower === first))) return [];
  const leadLength = (index) => Math.max(0, ...leads.filter((lead) => lead.every((word, offset) =>
    tokens[index + offset]?.lower === word)).map((lead) => lead.length));
  const leadEnd = (index) => {
    const length = leadLength(index);
    if (length) return index + length;
    const after = afterFiller(tokens, index);
    const restLength = leadLength(after);
    return restLength ? after + restLength : null;
  };
  const cuts = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const kind = grammar.joiners?.get(token.lower)?.kind;
    if (!(SENTENCE_END.has(token.text) || token.text === ',' || kind === 'coordination' || INDEPENDENT_JOINERS.has(kind))) continue;
    let after = i + 1;
    while (after < tokens.length && (tokens[after].text === ',' ||
        grammar.joiners?.get(tokens[after].lower)?.kind === 'coordination' ||
        INDEPENDENT_JOINERS.has(grammar.joiners?.get(tokens[after].lower)?.kind))) after++;
    const explicit = SENTENCE_END.has(token.text) || INDEPENDENT_JOINERS.has(kind) ||
      tokens.slice(i + 1, after).some((t) => INDEPENDENT_JOINERS.has(grammar.joiners?.get(t.lower)?.kind));
    cuts.push({ before: i, after, explicit, comma: token.text === ',' });
  }

  const spans = [];
  const starts = new Set([0, ...cuts.map((cut) => cut.after)]);
  for (const startTok of starts) {
    if (startTok <= (spans.at(-1)?.endTok ?? -1)) continue;
    const leadAfter = leadEnd(startTok);
    const following = tokens[leadAfter];
    if (leadAfter == null || !following || following.isPunct || grammar.negativeImperative.skip.has(following.lower)) continue;

    // An explicit new directive can end the prohibition. A coordinated noun
    // list or an elliptical continuation stays inside its scope.
    const cut = cuts.find((c) => c.before >= leadAfter && (c.explicit || c.comma) &&
      (leadEnd(c.after) != null || directiveAt(tokens, c.after, kb, !c.explicit)));
    const endTok = cut ? cut.before - 1 : tokens.length - 1;
    const start = tokens[startTok].start;
    const end = tokens[endTok].end;
    spans.push({ startTok, endTok, start, end });
  }
  return spans;
}

export function overlapsProhibition(candidate, scopes) {
  return scopes.some((scope) => candidate.startTok <= scope.endTok && scope.startTok <= candidate.endTok);
}
