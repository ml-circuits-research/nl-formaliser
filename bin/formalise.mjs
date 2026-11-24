#!/usr/bin/env node
// CLI for nl-formaliser:
//   node bin/formalise.mjs --tab drawing "please switch to the robot preset" [--top 3] [--verify] [--dump-smt]

import { createFormaliser } from '../src/index.mjs';

const rawArgs = process.argv.slice(2);
const opts = { tab: 'drawing', topK: 1, verify: false, dumpSmt: false, previous: null };
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--tab') opts.tab = rawArgs[++i];
  else if (a === '--top') opts.topK = Number(rawArgs[++i] ?? 1);
  else if (a === '--previous') opts.previous = rawArgs[++i];
  else if (a === '--knowledge') opts.knowledgeDir = rawArgs[++i];
  else if (a === '--timeout') opts.timeout = Number(rawArgs[++i] ?? 4000);
  else if (a === '--verify') opts.verify = true;
  else if (a === '--dump-smt') opts.dumpSmt = true;
  else if (a === '--help' || a === '-h') {
    console.log('Usage: node bin/formalise.mjs --tab drawing|diagram|document|calendar "<text>" [--top K] [--verify] [--dump-smt]');
    process.exit(0);
  } else {
    positional.push(a);
  }
}

const text = positional.join(' ').trim();
if (!text) {
  console.error('Provide input text. Example: node bin/formalise.mjs --tab drawing "make the house blue"');
  process.exit(2);
}

const formaliser = await createFormaliser({ knowledgeDir: opts.knowledgeDir, withVerifier: opts.verify });
const res = await formaliser.formalise(text, opts);

if (opts.dumpSmt && res.smt) {
  console.log('; === SMT-LIB2 ===');
  console.log(res.smt);
  console.log('; === OUTPUT ===');
}

if (!res.ok) {
  console.error(`ERROR (${res.status}): ${res.error}`);
  process.exit(1);
}

console.log(res.sop);
if (res.alternatives.length > 0) {
  res.alternatives.forEach((alt, i) => {
    console.log(`\n# --- alternative ${i + 2} ---`);
    console.log(alt);
  });
}
if (res.check) {
  console.error(`\n[verify] ok=${res.check.ok} errors=${res.check.errors.length} warnings=${res.check.warnings.length} (${Math.round(res.elapsedMs)}ms)`);
  for (const e of res.check.errors) console.error('  ERR:', e.type, e.key, '-', e.why);
  for (const w of res.check.warnings) console.error('  WARN:', w.why, w.words ?? '');
}
