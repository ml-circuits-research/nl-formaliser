# nl-formaliser

Symbolic Natural Language → **SOP Lang (`w.request`)** formaliser powered by **Z3 (SMT-LIB2 MaxSMT)** with a thin Node.js ES modules (`.mjs`) wrapper.

## Quickstart

```bash
# Run test suite (41 tests: KB, lattice, Z3 core, verifier, E2E)
npm test

# Formalise a single utterance
node bin/formalise.mjs --tab drawing "make the house blue" --verify
node bin/formalise.mjs --tab diagram "make a bar chart of the stadiums by country" --top 3 --verify
node bin/formalise.mjs --tab drawing "please switch to the robot preset" --dump-smt

# Run parallel stratified benchmarks (with Gold vs. Typo vs. Z3 error attribution)
node eval/benchmark.mjs --source webmeet --sample-pct 1 --seed 42 --workers 10
node eval/benchmark.mjs --source test --limit 500 --seed 42 --workers 10
node eval/benchmark.mjs --source keys --workers 10
```

## Documentation

Full technical documentation lives in [`docs/`](docs/index.html) (static multi-page HTML, open directly in any browser):

- [`docs/index.html`](docs/index.html) — Overview & quickstart
- [`docs/architecture.html`](docs/architecture.html) — 5-stage pipeline & strict layer contracts
- [`docs/z3-logic.html`](docs/z3-logic.html) — SMT-LIB2 datatypes (`smt/prelude.smt2`), hard axioms (`smt/axioms.smt2`), MaxSMT weights & variable elision
- [`docs/generality.html`](docs/generality.html) — Generality audit & playbook for onboarding new worlds/languages
- [`docs/evaluation.html`](docs/evaluation.html) — Fair evaluation results & Gold vs. Typo vs. Z3 root-cause attribution
- [`docs/spellchecker.html`](docs/spellchecker.html) / [`spell_checker_z3.md`](spell_checker_z3.md) — Two-layer Z3 orthographic normaliser & confidence estimation proposal
- [`docs/faq.html`](docs/faq.html) — Technical FAQ
