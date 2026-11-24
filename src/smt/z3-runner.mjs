// Thin persistent Z3 WASM runner using z3-solver's SMT-LIB2 evaluator (MaxSMT + push/pop).
// Resolves z3-solver from local node_modules or the sibling soplang-words-lib experiments install.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const PRELUDE_SMT = readFileSync(join(ROOT, 'smt', 'prelude.smt2'), 'utf8');
const AXIOMS_SMT = readFileSync(join(ROOT, 'smt', 'axioms.smt2'), 'utf8');

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

// Parse an S-expression string returned by Z3's (get-value (...)) into a Map<name, value>.
export function parseSmtValues(output) {
  const lines = String(output || '').split(/\r?\n/);
  const statusLine = lines.find((l) => /^(sat|unsat|unknown)\b/.test(l.trim()))?.trim() ?? 'unknown';
  const map = new Map();
  if (statusLine !== 'sat') return { status: statusLine, values: map, raw: output };

  // Find the S-expr list starting after the status line.
  const idx = output.indexOf('(');
  if (idx < 0) return { status: statusLine, values: map, raw: output };
  const body = output.slice(idx);

  // Tokenize S-expressions: '(', ')', or atom/string.
  const toks = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { toks.push(c); i++; continue; }
    if (c === '"') {
      let s = '"'; i++;
      while (i < body.length) {
        if (body[i] === '"' && body[i + 1] === '"') { s += '"'; i += 2; continue; }
        if (body[i] === '"') { s += '"'; i++; break; }
        s += body[i++];
      }
      toks.push(s);
      continue;
    }
    let a = '';
    while (i < body.length && !/[\s()]/.test(body[i])) a += body[i++];
    toks.push(a);
  }

  let pos = 0;
  function readExpr() {
    if (pos >= toks.length) return null;
    const t = toks[pos++];
    if (t !== '(') return t;
    const list = [];
    while (pos < toks.length && toks[pos] !== ')') list.push(readExpr());
    if (toks[pos] === ')') pos++;
    return list;
  }

  function decodeAtom(expr) {
    if (Array.isArray(expr)) {
      // Negative integer: (- 1)
      if (expr.length === 2 && expr[0] === '-' && /^\d+$/.test(expr[1])) return -Number(expr[1]);
      return expr;
    }
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\d+$/.test(expr)) return Number(expr);
    return expr;
  }

  // There may be one or more (get-value ...) blocks; merge them.
  while (pos < toks.length) {
    const block = readExpr();
    if (!Array.isArray(block)) continue;
    for (const pair of block) {
      if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') {
        map.set(pair[0], decodeAtom(pair[1]));
      }
    }
  }
  return { status: statusLine, values: map, raw: output };
}

export async function createZ3Runner({ module: explicitModule, timeoutMs = 4000 } = {}) {
  const z3Mod = await loadZ3Module(explicitModule);
  const { Context, Z3 } = await z3Mod.init();
  let ctx = new Context('nl_formaliser');
  let initialised = false;
  let solveCount = 0;

  async function ensureInit() {
    if (initialised) return;
    const header = `(set-option :timeout ${timeoutMs})\n${PRELUDE_SMT}\n${AXIOMS_SMT}\n`;
    const res = await Z3.eval_smtlib2_string(ctx.ptr, header);
    if (/\(error\b/.test(String(res))) {
      throw new Error('Z3 prelude/axioms SMT-LIB2 error: ' + res);
    }
    initialised = true;
  }

  // Periodically recreate context after many solves to keep WASM heap lean.
  async function maybeReset() {
    if (solveCount > 0 && solveCount % 250 === 0) {
      ctx = new Context(`nl_formaliser_${solveCount}`);
      initialised = false;
      await ensureInit();
    }
  }

  // Solve a MaxSMT problem body (declarations + assertions + assert-soft), returning values for `queryVars`.
  // Supports topK > 1 via blocking clauses over `blockVars`.
  async function solve(smtBody, queryVars, { topK = 1, blockVars = [], timeout = timeoutMs } = {}) {
    await ensureInit();
    await maybeReset();
    solveCount++;

    const solutions = [];
    const blocks = [];

    for (let k = 0; k < topK; k++) {
      const getVal = queryVars.length ? `(get-value (${queryVars.join(' ')}))` : '';
      const script = [
        '(push 1)',
        `(set-option :timeout ${timeout})`,
        smtBody,
        ...blocks,
        '(check-sat)',
        getVal,
        '(pop 1)',
      ].join('\n');

      const raw = await Z3.eval_smtlib2_string(ctx.ptr, script);
      if (/\(error\b/.test(String(raw))) {
        // Recover clean stack in case push succeeded before error.
        try { await Z3.eval_smtlib2_string(ctx.ptr, '(pop 1)'); } catch {}
        return { ok: false, status: 'error', error: String(raw).trim(), solutions };
      }

      const parsed = parseSmtValues(raw);
      if (parsed.status !== 'sat') {
        if (solutions.length > 0) break;
        return { ok: false, status: parsed.status, solutions, raw };
      }
      solutions.push(parsed.values);

      if (k + 1 < topK && blockVars.length > 0) {
        const lits = [];
        for (const v of blockVars) {
          const val = parsed.values.get(v);
          if (val === undefined) continue;
          const smtVal = typeof val === 'boolean' ? (val ? 'true' : 'false')
            : typeof val === 'number' && val < 0 ? `(- ${-val})`
            : String(val);
          lits.push(`(not (= ${v} ${smtVal}))`);
        }
        if (lits.length > 0) blocks.push(`(assert (or ${lits.join(' ')}))`);
        else break;
      }
    }

    return { ok: solutions.length > 0, status: solutions.length > 0 ? 'sat' : 'unsat', solutions };
  }

  // Diagnose an UNSAT core by wrapping named hard assertions in a fresh plain check.
  async function unsatCore(namedHardDeclsAndAsserts) {
    const diagCtx = new Context('nl_formaliser_diag');
    const script = [
      '(set-option :produce-unsat-cores true)',
      PRELUDE_SMT,
      AXIOMS_SMT,
      namedHardDeclsAndAsserts,
      '(check-sat)',
      '(get-unsat-core)',
    ].join('\n');
    const raw = await Z3.eval_smtlib2_string(diagCtx.ptr, script);
    return String(raw).trim();
  }

  function fullSmtDump(smtBody, queryVars = []) {
    const getVal = queryVars.length ? `(get-value (${queryVars.join(' ')}))` : '';
    return [
      `; Generated by nl-formaliser`,
      `(set-option :timeout ${timeoutMs})`,
      PRELUDE_SMT,
      AXIOMS_SMT,
      smtBody,
      '(check-sat)',
      getVal,
    ].join('\n');
  }

  return { solve, unsatCore, fullSmtDump };
}
