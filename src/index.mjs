// Public entry point for nl-formaliser:
//   const f = await createFormaliser({ knowledgeDir });
//   const res = await f.formalise('make the house blue', { tab: 'drawing' });

import { loadKnowledge } from './kb/load-worlds.mjs';
import { buildLattice } from './lattice/candidates.mjs';
import { encodeProblem } from './smt/encode.mjs';
import { createZ3Runner } from './smt/z3-runner.mjs';
import { modelToSop } from './emit/to-sop.mjs';
import { createVerifier } from './verify/check.mjs';

export async function createFormaliser({ knowledgeDir, timeoutMs = 4000, withVerifier = true } = {}) {
  const [kb, runner, verifier] = await Promise.all([
    loadKnowledge({ knowledgeDir }),
    createZ3Runner({ timeoutMs }),
    withVerifier ? createVerifier({ knowledgeDir }) : Promise.resolve(null),
  ]);

  async function formalise(text, {
    tab = 'drawing',
    previous = null,
    clock = null,
    topK = 1,
    maxRequests = 4,
    dumpSmt = false,
    verify = false,
    timeout = timeoutMs,
  } = {}) {
    const t0 = performance.now();
    const lattice = buildLattice(text, { tab, kb, previous, clock });
    const encoded = encodeProblem(lattice, { kb, previous, clock, maxRequests });
    const solved = await runner.solve(encoded.smtBody, encoded.queryVars, {
      topK,
      blockVars: encoded.blockVars,
      timeout,
    });
    const elapsedMs = performance.now() - t0;

    if (!solved.ok) {
      return {
        ok: false,
        status: solved.status,
        error: solved.error ?? `Z3 returned ${solved.status}`,
        sop: '',
        alternatives: [],
        elapsedMs,
        smt: dumpSmt ? runner.fullSmtDump(encoded.smtBody, encoded.queryVars) : undefined,
        stats: { tokens: lattice.tokens.length, candidates: lattice.candidates.length, maxR: encoded.meta.R },
      };
    }

    const circuits = solved.solutions.map((model) => modelToSop(model, lattice, encoded.meta));
    const sop = circuits[0] ?? '';
    const checkResult = verify && verifier ? verifier.check(text, sop, tab) : undefined;

    return {
      ok: true,
      status: 'sat',
      sop,
      alternatives: circuits.slice(1),
      check: checkResult,
      elapsedMs,
      smt: dumpSmt ? runner.fullSmtDump(encoded.smtBody, encoded.queryVars) : undefined,
      stats: { tokens: lattice.tokens.length, candidates: lattice.candidates.length, maxR: encoded.meta.R },
    };
  }

  return { formalise, kb, runner, verifier };
}
