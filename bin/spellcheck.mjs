#!/usr/bin/env node
// Standalone CLI for Layer 1 Z3 MaxSMT Spellchecker:
//   node bin/spellcheck.mjs [--top 3] [--json] "<text>"

import { loadKnowledge } from '../src/kb/load-worlds.mjs';
import { extractVocabFromKb } from '../src/spell/vocab.mjs';
import { createSpellChecker } from '../src/spell/z3-spell.mjs';

const rawArgs = process.argv.slice(2);
const opts = { topK: 1, json: false, knowledgeDir: undefined, timeoutMs: 2000 };
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--tab') {
    console.error('Unsupported option: --tab. Supply only the current text.');
    process.exit(2);
  } else if (a === '--top') opts.topK = Number(rawArgs[++i] ?? 1);
  else if (a === '--knowledge') opts.knowledgeDir = rawArgs[++i];
  else if (a === '--timeout') opts.timeoutMs = Number(rawArgs[++i] ?? 2000);
  else if (a === '--json') opts.json = true;
  else if (a === '--help' || a === '-h') {
    console.log('Usage: node bin/spellcheck.mjs [--top K] [--json] "<text>"');
    process.exit(0);
  } else {
    positional.push(a);
  }
}

const text = positional.join(' ').trim();
if (!text) {
  console.error('Provide input text. Example: node bin/spellcheck.mjs "copy the atble"');
  process.exit(2);
}

const kb = await loadKnowledge({ knowledgeDir: opts.knowledgeDir, includeLegacy: false });
const vocab = extractVocabFromKb(kb);
const checker = await createSpellChecker({ vocab, timeoutMs: opts.timeoutMs });
let res;
try {
  res = await checker.normalise(text, { topK: opts.topK });
} finally {
  await checker.close();
}

if (opts.json) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

if (!res.ok) {
  console.error(`ERROR (${res.status}): ${res.error ?? 'failed'}`);
  process.exit(1);
}

console.log(res.cleanText);
console.error(
  `[spell] changed=${res.changed} usedZ3=${res.usedZ3} editCost=${res.totalEditCost}` +
  (res.margin !== null ? ` margin=${res.margin}` : '') +
  ` vocab=${vocab.stats.wordCount} (${res.elapsedMs.toFixed(1)}ms)`
);
if (res.changed) {
  for (const t of res.tokens) {
    if (t.op !== 'keep' && t.op !== 'pass_through' && t.op !== 'punct') {
      console.error(`  ${t.op}: "${t.rawText}" [${t.rawStart},${t.rawEnd}) -> "${t.text}" (cost=${t.editCost})`);
    }
  }
}
if (opts.topK > 1 && res.alternatives.length > 1) {
  res.alternatives.slice(1).forEach((alt, idx) => {
    console.error(`  alt ${idx + 2}: "${alt.cleanText}" (editCost=${alt.totalEditCost})`);
  });
}
