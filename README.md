# nl-formaliser

Symbolic Natural Language → **SOP Lang (`w.request`)** formaliser powered by **Z3 (SMT-LIB2 MaxSMT)** with a thin Node.js ES modules (`.mjs`) wrapper.

## Quickstart

```bash
# Run full test suite (57 tests: dynamic SOP KB, lattice, standalone Z3 spellchecker, v9 2-stage Z3 + confidence, verifier, E2E)
npm test

# Run standalone Layer 1 Z3 Spellchecker (independent of formaliser)
npm run test:spell
node bin/spellcheck.mjs --top 2 "the losing months should stando ut, so make theb ars below 7 teal"
node bin/spellcheck.mjs --tab diagram --json "bar ch art"

# Formalise a single utterance (Layer 2 Z3 MaxSMT, optional Layer 1 --spellcheck and calibrated --confidence)
node bin/formalise.mjs --tab drawing "make the house blue" --verify --confidence
node bin/formalise.mjs --tab drawing "copy the atble" --spellcheck --verify --confidence
node bin/formalise.mjs --tab diagram "make a bar chart of the stadiums by country" --top 3 --verify --confidence
node bin/formalise.mjs --tab drawing "please switch to the robot preset" --dump-smt

# Calibrate confidence weights on disjoint dev split (seed=1337) & run parallel benchmarks (seed=42)
node eval/calibrate.mjs
node eval/benchmark.mjs --source webmeet --sample-pct 1 --seed 42 --workers 10 --spellcheck --confidence
node eval/benchmark.mjs --source test --limit 500 --seed 42 --workers 10 --spellcheck --confidence
node eval/benchmark.mjs --source keys --workers 10
```

The result includes `unresolved` when the reader detects a directive prohibition that the current `w.request` contract cannot represent. Each entry carries its exact text and half-open character offsets in the original input. `status: "partial"` accompanies independently formalised clauses. When only the prohibition remains, the result has `status: "unknown"` and no SOP proposal. The text CLI prints this diagnostic to standard error.

## Text-only library and batch

Both checkouts expose `src/reader.mjs`. For Z3, import from `nl-formaliser`. The equivalent import from `pro-formaliser` opens the Prolog engine.

```js
import { createReader } from './nl-formaliser/src/reader.mjs';

const reader = await createReader();
try {
  const result = await reader.propose('Move it to the left');
  console.log(result.engine, result.candidates, result.unresolved);
} finally {
  await reader.close();
}
```

The reader loads its resources once and reuses them for subsequent calls. `propose(text)` uses the original text and the loaded knowledge. Close the reader after its last call.

The batch CLI takes the same inputs and returns the same common result from either checkout. Run it from any directory with the respective absolute path.

```sh
node /home/salboaie/work/sopworlds/pro-formaliser/bin/formalise.mjs --batch < texts.jsonl > prolog-results.jsonl
node /home/salboaie/work/sopworlds/nl-formaliser/bin/formalise.mjs --batch < texts.jsonl > z3-results.jsonl
```

Each input line contains a JSON object such as `{"text":"Move it to the left"}`. Only a nonempty `text` string is accepted. Blank lines are skipped. Both commands write one compact JSON object per other input line, in input order. Z3 batch defaults to automatic world proposals and rejects records with history, clock, or context fields.

The common fields are `engine` (`"z3"` or `"prolog"`), the original `text`, `candidates` (each with `sop`), `unresolved` (a diagnostic array), and `error` (a message or `null`). An unknown reading can return an empty candidate array. A partial reading can return candidates alongside unresolved evidence. A malformed row has an error and an empty candidate array. One row's failure does not stop the remaining rows.

Z3 retains its ranked variants, status, and native verification on each candidate. Its `unresolved` array projects native `w.request.unread` wires with their candidate index and includes unresolved directives reported by the engine. Its `check` fields contain `ok`, `errors`, `warnings`, and `uncoveredWords`.

## Documentation

Full technical documentation lives in [`docs/`](docs/index.html) (static multi-page HTML, open directly in any browser):

- [`docs/index.html`](docs/index.html) — Overview & quickstart
- [`docs/architecture.html`](docs/architecture.html) — 5-stage pipeline & strict layer contracts
- [`docs/z3-logic.html`](docs/z3-logic.html) — SMT-LIB2 datatypes (`smt/prelude.smt2`), hard axioms (`smt/axioms.smt2`), MaxSMT weights & variable elision
- [`docs/generality.html`](docs/generality.html) — Generality audit & playbook for onboarding new worlds/languages
- [`docs/evaluation.html`](docs/evaluation.html) — Fair evaluation results & Gold vs. Typo vs. Z3 root-cause attribution
- [`docs/spellchecker.html`](docs/spellchecker.html) / [`spell_checker_z3.md`](spell_checker_z3.md) — Standalone Layer 1 Z3 orthographic normaliser (`src/spell/*`) & confidence estimation proposal
- [`docs/faq.html`](docs/faq.html) — Technical FAQ
