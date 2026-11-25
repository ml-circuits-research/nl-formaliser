#!/usr/bin/env node
// CLI for nl-formaliser:
//   node bin/formalise.mjs --tab drawing "please switch to the robot preset" [--top 3] [--verify] [--spellcheck] [--confidence] [--json] [--dump-smt]

import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createFormaliser } from '../src/index.mjs';
import { createReader, readerError } from '../src/reader.mjs';

const rawArgs = process.argv.slice(2);
const opts = {
  tab: undefined,
  topK: 1,
  verify: false,
  spellcheck: false,
  confidence: false,
  json: false,
  dumpSmt: false,
  previous: null,
  batch: false,
};
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--tab') opts.tab = rawArgs[++i];
  else if (a === '--top') opts.topK = Number(rawArgs[++i] ?? 1);
  else if (a === '--previous') opts.previous = rawArgs[++i];
  else if (a === '--knowledge') opts.knowledgeDir = rawArgs[++i];
  else if (a === '--timeout') opts.timeout = Number(rawArgs[++i] ?? 4000);
  else if (a === '--verify') opts.verify = true;
  else if (a === '--spellcheck') opts.spellcheck = true;
  else if (a === '--confidence') opts.confidence = true;
  else if (a === '--batch') opts.batch = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--dump-smt') opts.dumpSmt = true;
  else if (a === '--help' || a === '-h') {
    console.log('Usage: node bin/formalise.mjs --tab drawing|diagram|document|calendar|auto "<text>" [--top K] [--verify] [--spellcheck] [--confidence] [--json] [--dump-smt]');
    console.log('       node bin/formalise.mjs --batch [--json] [--tab auto] [--verify] < inputs.jsonl');
    process.exit(0);
  } else {
    positional.push(a);
  }
}

const text = positional.join(' ').trim();
if (opts.batch && (positional.length || rawArgs.includes('--previous'))) {
  console.error('--batch reads {"text":"..."} records from stdin and takes no positional text or --previous.');
  process.exit(2);
}
if (!opts.batch && !text) {
  console.error('Provide input text. Example: node bin/formalise.mjs --tab drawing "make the house blue"');
  process.exit(2);
}
opts.tab ??= opts.batch ? 'auto' : 'drawing';

if (opts.batch) {
  try {
    const reader = await createReader(opts);
    try {
      await runBatch(reader);
    } finally {
      await reader.close();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
} else {
  const formaliser = await createFormaliser({
    knowledgeDir: opts.knowledgeDir,
    withVerifier: opts.verify || opts.spellcheck || opts.confidence,
    spellcheck: opts.spellcheck,
  });
  try {
    await runSingle(formaliser, text);
  } finally {
    await formaliser.close();
  }
}

async function formaliseLine(reader, line, lineNumber) {
  const invalid = { status: 'invalid-input', line: lineNumber };
  let input;
  try {
    input = JSON.parse(line);
  } catch {
    return readerError(null, 'Expected one JSON object per line.', invalid);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.text !== 'string' || !input.text.trim() ||
      Object.keys(input).some((key) => key !== 'text')) {
    return readerError(input?.text, 'Expected an object with only a nonempty text string.', invalid);
  }

  const result = await reader.propose(input.text);
  return result.status === 'error' ? { ...result, line: lineNumber } : result;
}

async function runBatch(reader) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of input) {
    lineNumber++;
    if (!line.trim()) continue;
    const result = await formaliseLine(reader, line, lineNumber);
    if (!process.stdout.write(`${JSON.stringify(result)}\n`)) await once(process.stdout, 'drain');
  }
}

async function runSingle(formaliser, input) {
  const res = await formaliser.formalise(input, opts);

  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (opts.dumpSmt && res.smt) {
    console.log('; === SMT-LIB2 ===');
    console.log(res.smt);
    console.log('; === OUTPUT ===');
  }

  for (const scope of res.unresolved ?? []) {
    console.error(`[unresolved ${scope.kind}] ${scope.text}`);
  }

  if (!res.ok) {
    console.error(`ERROR (${res.status}): ${res.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(res.sop);
  if (res.alternatives.length > 0 && opts.topK > 1) {
    res.alternatives.forEach((alt, i) => {
      console.log(`\n# --- alternative ${i + 2} ---`);
      console.log(alt);
    });
  }
  if (res.spell?.changed) {
    console.error(`\n[spell] "${res.spell.rawText}" -> "${res.spell.cleanText}" (editCost=${res.spell.totalEditCost})`);
  }
  if (res.confidence) {
    console.error(`\n[confidence] ${res.confidence.summary}`);
  }
  if (res.check) {
    console.error(`\n[verify] ok=${res.check.ok} errors=${res.check.errors.length} warnings=${res.check.warnings.length} (${Math.round(res.elapsedMs)}ms)`);
    for (const e of res.check.errors) console.error('  ERR:', e.type, e.key, '-', e.why);
    for (const w of res.check.warnings) console.error('  WARN:', w.why, w.words ?? '');
  }
}
