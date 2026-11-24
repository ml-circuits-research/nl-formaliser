# nl-formaliser

Symbolic Natural Language → **SOP Lang (`w.request`)** formaliser powered by **Z3 (SMT-LIB2 MaxSMT)** with a thin Node.js ES modules (`.mjs`) wrapper.

All global semantic disambiguation — clause splitting, act/mode/mood/question inference, target family/mode/fill/lookup enforcement, `key_words` binding, selector-vs-result phase, negation scope, and `unread` fallback — is solved declaratively by Z3 over `smt/prelude.smt2` and `smt/axioms.smt2`.

## Architecture

1. **Knowledge Loader ([`src/kb/load-worlds.mjs`](src/kb/load-worlds.mjs))**: Dynamically reads `w.request/shards/keys.sop` (430 keys across `drawing`, `diagram`, `document`, `calendar`), `k.actions`, `w.lang.en`, and domain lexicons from `../sop-knowledge-worlds` (~180 ms).
2. **Unfiltered Lexical Lattice ([`src/lattice/candidates.mjs`](src/lattice/candidates.mjs))**: Enumerates all grounded candidate spans without semantic disambiguation (`FILLER`, `SEP`, `PREDICATE`, `TARGET_SORT`, `TARGET_FAMILY`, `TARGET_REF`, `KEY_WORD`, `CONSTRAINT`, `NEG`, `UNREAD`).
3. **Z3 MaxSMT Core ([`smt/prelude.smt2`](smt/prelude.smt2), [`smt/axioms.smt2`](smt/axioms.smt2), [`src/smt/encode.mjs`](src/smt/encode.mjs), [`src/smt/z3-runner.mjs`](src/smt/z3-runner.mjs))**: Encodes `w.request` hard invariants (lookup necessity law, filler purity, token non-overlap, act–target–mood compatibility, keeping-verb exclusion, phase law, key-word binding) and soft MaxSMT preferences; invokes persistent `z3-solver` WASM with `(push 1)/(pop 1)` and supports `topK` ranked alternatives.
4. **Deterministic Emitter ([`src/emit/to-sop.mjs`](src/emit/to-sop.mjs))**: Projects Z3 models into canonical `w.request` SOP Lang wires.
5. **Verifier & Fair Benchmark ([`src/verify/check.mjs`](src/verify/check.mjs), [`eval/compare.mjs`](eval/compare.mjs), [`eval/benchmark.mjs`](eval/benchmark.mjs))**: Validates output against `sopworld` + `w.request` + `k.actions` + `w.lang.en` (full parity with `webmeet-dataset/tools/check.mjs`) and separates gold annotation defects from formaliser errors.

## Usage

```bash
# Run unit, Z3 core, verifier, and E2E tests (38 tests)
npm test

# Formalise a single utterance
node bin/formalise.mjs --tab drawing "make the house blue" --verify
node bin/formalise.mjs --tab diagram "make a bar chart of the stadiums by country" --top 3 --verify
node bin/formalise.mjs --tab drawing "please switch to the robot preset" --dump-smt

# Run parallel stratified benchmarks
node eval/benchmark.mjs --source webmeet --sample-pct 1 --seed 42 --workers 10
node eval/benchmark.mjs --source test --limit 500 --seed 42 --workers 10
node eval/benchmark.mjs --source keys --workers 10
```

## Measured Evaluation Results

Evaluated across **2,822** utterances (`100.0%` schema & grounding valid under `check.mjs`, 0 errors, 0 Z3 timeouts):

### 1. `webmeet-dataset` — 1% Random Sample (`N = 1,892`, `seed = 42`, 10 Z3 workers)

| Tab | N | Valid | 0-Warn | GoldFlawed | Exact | BetterGold | EffSuccess | Partial | Wrong | CleanGoldExact | Act | Fam | AliasF1 | p50ms | p95ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| drawing | 931 | 100.0% | 50.8% | 27.7% | 13.3% | 1.9% | 15.3% | 51.6% | 33.2% | 15.4% | 48.9% | 67.0% | 0.429 | 117 | 1607 |
| diagram | 759 | 100.0% | 47.2% | 44.8% | 6.1% | 1.2% | 7.2% | 44.7% | 48.1% | 8.3% | 40.4% | 45.3% | 0.251 | 211 | 2301 |
| document | 122 | 100.0% | 69.7% | 9.8% | 13.9% | 0.0% | 13.9% | 63.1% | 23.0% | 15.2% | 74.6% | 63.1% | 0.396 | 162 | 876 |
| calendar | 80 | 100.0% | 87.5% | 1.3% | 28.8% | 0.0% | 28.8% | 63.8% | 7.5% | 29.1% | 71.3% | 90.0% | 0.748 | 126 | 1133 |
| **ALL** | **1,892** | **100.0%** | **52.1%** | **32.3%** | **11.1%** | **1.4%** | **12.5%** | **50.1%** | **37.4%** | **13.7%** | **48.1%** | **59.0%** | **0.369** | **155** | **1842** |

Gold annotation defects measured independently by `check.mjs` on `webmeet-dataset` (1%): `32.3%` total (`17.0%` `gold_left_unread`, `16.0%` `gold_uncovered_words`, `4.2%` `gold_bad_filler`, `1.6%` `gold_hull_overlap`).

### 2. `psys2/official-dataset/test.jsonl` (`N = 500`, `seed = 42`)

- **Valid**: `100.0%` (`500/500`), **0-Warn**: `49.6%`
- **GoldFlawed**: `66.6%` (`59.6%` `gold_uncovered_words`, `29.0%` `gold_left_unread`, `3.4%` `gold_missing_proper_name`)
- **Exact**: `9.8%`, **BetterGold**: `6.0%`, **EffSuccess**: `15.8%` (**CleanGoldExact**: `18.9%`), **Partial**: `47.8%`, **Wrong**: `36.4%` (`document` Wrong: `4.4%`, `Act`: `95.6%`)
- **Latency**: p50 `160 ms`, p95 `2.38 s`

### 3. `w.request/shards/keys.sop` Examples (`N = 430`)

- **Valid**: `100.0%` (`430/430`), **KeyHit**: `27.7%`, p50 `51 ms`, p95 `119 ms`
