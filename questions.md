# Worker proposals and review requests

The implementation worker owns this file. Append proposals, questions and READY reports here. The reviewer writes decisions and task assignments only in `resposens.md` (the filename is intentional).

Use a stable heading such as `## Q-NL-001 — <mechanism>`. Include the observed failure, exact source/data/knowledge revisions, actual examples and controls, the reusable mechanism proposed, owning schema/knowledge changes, implementation paths, expected semantic effect and a bounded validation run. Distinguish a schema gap, a data error, a reader limitation and an actual contradiction. Preserve source evidence and compatible alternatives. Reference shared canonical definitions rather than copying another formaliser's local proposal.

Reader mechanisms can be implemented and committed autonomously under the current owner authorization. Submit completion as `## READY Q-NL-...` with actual results and remaining limits for post-commit review. Route reusable knowledge and schema changes through this file for coordinator approval. The reviewer owns `resposens.md`.

## Q-NL-001 — Preserve spatial selectors inside a property owner's noun phrase

I request review and approval for the reader change below. Please record the scoped decision and any data assignment in `resposens.md`.

**Measured baseline.** `nl-formaliser` at `171ec254b6966eaf818106cee24d78b7d92e5024` loaded canonical `sop-knowledge-worlds` at `f48e08f7a285e23534228eb8a6b6f07e78cd64a3`. I ran `node bin/formalise.mjs --tab diagram --top 3 --verify '<utterance>'` for each case. The verifier accepted the top circuit in each case, including the two with the wrong meaning. These are authored probes. No dataset rows or split scores enter the measurement.

| Utterance | Observed top circuit | Expected reading |
| --- | --- | --- |
| Set the width on the node under the oval to 15 | `act=place`, `page.fit=width`, a spatial `on` anchored to `node`, `node.position=below` as a result anchored to `oval`, and `node.value=15`. | Change `node.width` to `15` on the existing node selected by `under the oval`. |
| Set the width on the node on the oval to 15 | `act=change`, target `family=node sort=oval`, `page.fit=width` as a selector and `node.value=15` as a result. | The first `on` introduces the owner. The second `on` selects the node by its relation to `oval`. Set that node's width to `15`. |
| Set the width on the node to 15 | `act=change`, existing `node`, `node.width=15 phase=result`. | Preserve this property change without adding a spatial effect. |
| Move the node under the oval | `act=place`, existing `node`, `node.position=below words=under phase=result` anchored to `oval`. | Preserve the spatial result on the existing node. |

None of the three ranked proposals for either nested example contained `node.width`. With the same loaded knowledge, `buildLattice` matched `acts.change.property.on` in both nested cases and put token positions 3 through 8 in `blockedSpatialToks`. That includes the structural `on` at position 3 and the separate spatial cue at position 6. The property frame offers `chart.width`, `link.width`, `node.size` and `node.width`; it does not bind the width result to the particular owner candidate. In `src/smt/encode.mjs` §7b, selecting this frame excludes spatial and anchor candidates overlapping the mask. The model can instead skip the frame, as permitted by its soft selection constraint. Keeping the property frame active and the nested spatial interpretation is therefore impossible with this mask. The baseline isolates this failure path; it does not establish that changing the mask alone will rank the correct circuit first.

**Existing declarations.** `w.lang.en.part.acts.change.property.on.4` declares the structural `on` marker and part 6 declares the owner role. `w.request.key.diagram.node.width` identifies the numeric property. `node.position` and `node.anchor` express the relation to the oval, and `w.request.constraint.phase` distinguishes selection from result. These declarations cover the intended reading. The measured failure is in how the reader attaches the roles.

**Proposed scope.** In `src/lattice/frames.mjs` and `src/smt/encode.mjs` §7b, keep the structural marker's exact span and suppress spatial candidates that interpret that occurrence as a spatial cue while the property frame is active. Allow a separate spatial cue and its anchor within the owner span to serve as selectors on that owner. Couple the keyed result to the selected owner and preserve compatible alternatives as solver hypotheses. Use frame roles and evidence ranges across owner families and properties. The two occurrences of `on` in the second probe must retain distinct roles.

**Acceptance and request to WebMeet.** Run the same four CLI probes after the change and run `npm test`. The top circuits for both nested probes must have the existing node, the grounded spatial selector anchored to the oval and the `node.width=15` result in one request. The two controls must retain their original effects. For the data session, I request a bounded search for existing equivalents of these nested and control cases. If annotations for those examples are missing or misphase a role, return proposed rows or corrections with exact text evidence and verify any approved edits with `node tools/check.mjs`. The four authored probes can stay in the reader validation until that review.

## READY Q-NL-001 — Owner selectors preserved in the leading circuit

Base source `171ec254b6966eaf818106cee24d78b7d92e5024`. Tested against canonical knowledge `f48e08f7a285e23534228eb8a6b6f07e78cd64a3`. The changes are in `src/lattice/frames.mjs`, `src/smt/encode.mjs` and `test/property-owner.test.mjs`.

The frame passes the matched part and token span for the owner marker to Z3. With that frame active, only spatial competitors that overlap the marker are excluded. A relation cue and landmark that complete the owner description can bind to a head candidate before the cue. The property value must bind to the frame's exact keyword evidence, which lets Z3 join it across a longer owner phrase. The role assignments apply to the selected frame and request. If no frame is active, the ordinary keyword distance and spatial alternatives still apply.

### CLI results

Top circuits from `node bin/formalise.mjs --tab diagram --top 3 --verify '<utterance>'`. All four final circuits passed verification with zero errors and warnings.

**Set the width on the node under the oval to 15**

Before

```sop
@r1 w.request.request act=place mood=do predicate=Set
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=page.fit value=width operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.relation value=on operator=relation phase=result
@r1.c3 w.request.constraint request=$r1 on=place attribute=node.anchor value=node operator=relation phase=selector
@r1.c4 w.request.constraint request=$r1 on=place attribute=node.position value=below words=under operator=relation phase=result
@r1.c5 w.request.constraint request=$r1 on=place attribute=node.anchor value=oval operator=relation phase=selector
@r1.c6 w.request.constraint request=$r1 on=attribute attribute=node.value value="15" operator=eq phase=result
```

After

```sop
@r1 w.request.request act=change mood=do predicate=Set
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context family_words=node
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=place attribute=node.position value=below words=under operator=relation phase=selector
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.anchor value=oval operator=relation phase=selector
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=node.width value="15" operator=eq phase=result key_words=width
```

**Set the width on the node on the oval to 15**

Before

```sop
@r1 w.request.request act=change mood=do predicate=Set
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=description sort=oval family_words=node
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=page.fit value=width operator=eq phase=selector
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=node.value value="15" operator=eq phase=result
```

After

```sop
@r1 w.request.request act=change mood=do predicate=Set
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context family_words=node
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=place attribute=node.position value=on operator=relation phase=selector
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.anchor value=oval operator=relation phase=selector
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=node.width value="15" operator=eq phase=result key_words=width
```

**Set the width on the node to 15**, same leading circuit before and after

```sop
@r1 w.request.request act=change mood=do predicate=Set
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context family_words=node
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=node.width value="15" operator=eq phase=result key_words=width
```

**Move the node under the oval**, same leading circuit before and after

```sop
@r1 w.request.request act=place mood=do predicate=Move
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context family_words=node
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=place attribute=node.position value=below words=under operator=relation phase=result
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.anchor value=oval operator=relation phase=selector
```

### Gates and scope

- `node --test test/property-owner.test.mjs` passed 8/8, including a Z3 model assertion that the structural `on` is token 3 and only the occurrence at token 6 is selected as a spatial cue.
- The independent height probe binds `node.height=20` as the result and `near the triangle` as the selector. The drawing probe binds `drawn.colour=blue` on the existing house selected by `behind the tree`. The tests assert the exact constraint sets and reject invented effects.
- `npm test` passed 69/69. `git diff --check` passed.
- The selector binding covers a relation with an emitted landmark candidate inside the matched owner phrase. The four CLI probes leave the actual node identity to the page lookup. General segmentation and new dataset rows were outside this batch. The reviewer owns publication.

**Additional checks after the reviewer published the intent contract.** `npm test` also passed 69/69 against canonical knowledge `ae80c054199849d4918058b10a165618be38c2df`. I ran the two cited WebMeet discovery rows with their exact `@prev` text via `--previous`, at dataset `41aae16e6d9c1e8b080d6f2b0184bb8b8cc28572`. Both preserve the requested fill colour and emit a previous-turn lookup, while leaving `same` unread and adding unsupported numeric and endpoint effects from the purpose phrase. In `diagram/nodes-01.csv` at physical line 6403 the selector retains `behind`, but the title landmark is unread. In `diagram/diagrams-03.csv` at physical line 20387 the model reads `table` as a grid layout and drops both the adjacent relation and its anchor. The verifier reports one warning for each. These contextual constructions remain open and are distinct from the four property-frame acceptance probes.

## Q-NL-002 — Correct the phase and polarity of an excluded link destination in WebMeet

I request review and approval to route this annotation correction to the WebMeet data session. The affected row in `diagram/ui-coverage.csv` at dataset revision `41aae16e6d9c1e8b080d6f2b0184bb8b8cc28572` is line 3683, “the arrow from Approved? should end at Done, not Publish”.

`@r1.c1` correctly selects the source `Approved?`, and `@r1.c2` sets the desired destination to `Done`. `@r1.c3` currently says `attribute=link.to value=Publish operator=eq phase=selector`, with `want=yes` by default. That would require an arrow currently ending at `Publish`. An arrow from `Approved?` to `Draft` is also a possible target because the utterance leaves its current destination open. Here `not Publish` contrasts with the desired `Done`. In the contrast control “redirect the arrow currently ending at Publish to Done”, the same destination name is evidence of a positive selector because the text explicitly identifies it as current.

Canonical `w.request` at `f48e08f7a285e23534228eb8a6b6f07e78cd64a3` declares `link.from`, `link.to`, `phase=selector|result` and `want=yes|no|not_all`. This is an annotation error. Propose replacing `@r1.c3` with `@r1.c3 w.request.constraint request=$r1 on=attribute attribute=link.to value=Publish operator=eq phase=result want=no`. Preserve the exact utterance and the other wires. The proposed polarity preserves the explicit exclusion even when the positive result independently determines the destination.

For acceptance, I request that the data session verify both readings, run `node tools/check.mjs` on the corrected CSV, and report the scoped migration for the changed wire. Inspect any analogous contrast rows individually because some explicitly name an old destination. The proposed change is to this annotation.

## Q-NL-003 — Preserve an explicit purpose clause on its request

I request scoped review for the language evidence and reader support for postposed purpose clauses. Canonical knowledge `ae80c054199849d4918058b10a165618be38c2df` now defines `w.request.intent` with a typed request owner, a `purpose` role, a written value and verbatim evidence. The English bank classifies `so` as a conjunction in `closed-classes.sop` and lists bare `so` among fillers in `hand-request.sop`. Neither declaration licenses which preceding directive a purpose clause modifies.

**Measured baseline.** I ran the current checkout, based on `171ec254b6966eaf818106cee24d78b7d92e5024` with the Q-NL-001 reader changes, against the canonical knowledge above. “Fill the rectangle green so the two are easy to tell apart” and the `so that` variant both emit the correct colour result plus invented results `node.value=2` and `link.to="tell apart"`, with `easy` unread. Both passed the structural verifier with one warning. The two exact WebMeet rows reported under READY Q-NL-001 exhibit the same invented effects. The controls “Fill the rectangle green, please” and “Fill the rectangle green, then move the triangle left” produce the expected one and two requests respectively, with zero warnings. The reason-first control “The two are easy to tell apart, so fill the rectangle green” produces the two spurious attributes as selectors. Its first clause states a reason for the directive and does not state the directive's intended outcome.

**Proposed scope.** Ask the language owner to publish or identify a reusable construction that licenses a following `so that` purpose clause on a directive and offers the same candidate for contextually compatible `so` clauses. The declaration needs the directive role, marker span and subordinate clause role. The reason-first reading and separate commands need their own boundaries. For the reader, propose an intent candidate over the grounded subordinate span and bind it in Z3 to the selected preceding request via the construction. An active intent must consume its exact evidence independently of application attributes. Keep ambiguity as competing hypotheses for bare `so` and preserve unsupported clause text as unresolved. Project the winning purpose as `@r1.i1 w.request.intent request=$r1 role=purpose value="the two are easy to tell apart" words="so that the two are easy to tell apart"` for the explicit `so that` probe, with the original fill constraint intact. Destination interpretation and application execution are outside the proposed increment.

**Acceptance.** Review the language contract and reader change separately before implementation. Run the five bounded probes above and the two unchanged WebMeet texts as observational cases. Check exact clause evidence and request ownership, absence of the invented numeric and endpoint effects in the purpose result, and preservation of the separate-command and politeness controls. Keep the reason-first clause explicit as unresolved if its relation remains unsupported. Validate the intent wires using the published schema and the dataset codec once the coordinator confirms the codec gate. Add focused reader tests and run `npm test`.

## READY Q-NL-004 — Bind complete property names to their local edit values

I request review of this implemented and validated reader diff under the owner's instruction to test changes before submitting them. Source baseline `09e20d4452911c15f596133773dcb977e657d788`, canonical knowledge `ae80c054199849d4918058b10a165618be38c2df`, WebMeet `340eb4dc9c433c078ca19d4490e822f4ee92562e`.

| Probe | Baseline top reading | Validated top reading |
| --- | --- | --- |
| `make the marker size small` (`diagram/charts-02.csv`, record 4354) | Existing node named `marker`, `node.size=small`, `key_words=size`. | Existing chart via page lookup, `chart.markerSize=small`, `key_words="marker size"`, result. |
| `set its text colour to blue` with previous `select Start` (`diagram/diagrams-07.csv`, record 207) | Existing node named `text`, `node.colour=blue`, `key_words=colour`. | Existing node via previous-turn lookup, `node.textColour=blue`, `key_words="text colour"`, result. |
| `set the line width to 4` | Existing node of sort `line`, `node.width=4`, `key_words=width`. | Existing chart via page lookup, `chart.lineWidth=4`, `key_words="line width"`, result. The node-width reading remains in the top three for Diagram. |

**Mechanism and ranking.** `src/kb/load-worlds.mjs` keeps the lexicalized short name and its spelling variants separately from looser aliases. `src/smt/encode.mjs` gives one soft preference to binding a multi-token exact name to a nearby value candidate that requires its key, with a selected, change-licensed predicate in the same request. The cue and value must be separated only by grammar tokens. `src/smt/weights.json` sets this weight to 50. On the measured baseline models, selecting the full keyword cost an extra 29 for `marker size`, 44 for `text colour` and 47 for `line width`. The 50-point preference covers those competing evidence costs on the dev probes. A definite or possessive property modifier adds the existing resultative weight for `change` on an existing owner only after the key, verified predicate and result are bound in that request. This remains a preference. It leaves shorter and alternate owner readings satisfiable and retains all existing family compatibility and published aliases.

**Controls and gates.** `test/compound-property.test.mjs` checks British and US spellings, a quoted chart named `Marker Size`, an indefinite new chart with a large marker size, two commands with separate node and chart owners, and the ranked shorter reading of `line width`. The tests assert grounded key spans and the relevant owner, lookup, phase and value wires. `npm test` passed 76/76 and `git diff --check` passed.

| Run | Baseline | Candidate |
| --- | ---: | ---: |
| Dev 250, seed 1337, L1c | 64 (25.6%) | 62 (24.8%) |
| Dev 250, seed 1337, L3+L4 | 123 (49.2%) | 125 (50.0%) |
| WebMeet 1%, seed 42, L1c | 612 (32.3%) | 613 (32.4%) |
| WebMeet 1%, seed 42, L3+L4 | 659 (34.8%) | 656 (34.7%) |

Both runs used tab-agnostic mode, Z3 grading, up to eight proposals, two candidates per tab and spellcheck off. The paired dev diagnostic switched the preference on and off in the same process. Both rows whose full-input SMT changed are the two WebMeet lines above, and both changed from L1c to L4. The repeated dev run also reports one fewer reasonable Drawing case. Its full-input SMT was identical for all Drawing rows with the preference on and off. On the 1% sample, the paired diagnostic found five changed full-input models among rows with contiguous literal compound names. Their five grades stayed the same. These results verify the local repair and show no improvement in the measured holdout total. The overall 90% target remains open.

## Q-NL-005 — Distinguish named scenes from composed page settings

Reader `be6d0b0`, knowledge `ae80c054`, WebMeet `340eb4d`. Drawing CLI probes with `--top 3 --verify` read “turn the scene into a bright sunny afternoon” as the single result `page.scene="bright sunny afternoon"`. “make the scene a rainy evening” can produce independent `page.weather=rain` and `page.time=evening`, along with an invented additional `page.scene=scene`. The control “make a rainy day scene” also emits `page.scene=scene` plus `page.weather=rain`, although `k.scenes.scene.rainy_day` declares the named scene `rainy day`. The standalone lookup “set the weather to overcast” correctly uses the distinct value `overcast`.

`w.drawing.page.scene` references names in `k.scenes.scene`. `w.drawing.page.weather` and `w.drawing.page.time` are independent typed slots. The reader's existing weather table conflates aliases with larger phrases, for example `sunny afternoon` for `sun` and `rainy day` for `rain`. It also maps `overcast` to `cloud` and `mist` to `fog` alongside the independent values. In the first CLI case the matched frame offers the whole phrase as an open scene value. Known lexical candidates for `bright sunny` and `afternoon` already cover separate evidence spans. `k.scenes.word.scene` declares `scene` as vocabulary for the type and `k.scenes.scene.rainy_day` declares a catalog member. Treating the type word itself as a scene member invents a scene value.

I propose that the knowledge session publish or identify slot-scoped lexical aliases for the weather enum and the attachment boundary for composed scene settings. Weather aliases should carry weather evidence only and preserve distinctions such as mist versus fog. A catalog scene name should remain a licensed value even when its wording contains a weather term. The reader can then consume the declared aliases and compose weather and time results when the scene construction licenses both roles. For WebMeet, please review `drawing/scenes-07.csv` at physical line 16570. Its `page.weather` evidence contains `afternoon`, yet the row omits a time wire. Compare `scenes-07.csv` record 2813, “turn the scene into a thunderstorm at night”, which explicitly encodes both. The proposal preserves unresolved scene descriptions when the text supplies a scene beyond those fields.

## Q-NL-006 — License property-owner subjects and colon assignments

Reader `be6d0b0`, knowledge `ae80c054`, WebMeet `340eb4d`. In Diagram CLI probes, “the label on Publish should be Release” emits `act=send predicate=Publish`, a chart named `Release`, and a share selector. “new label on the circle: Closed” emits a chart-share result, a chart marker `circle`, and uses `Closed` as the predicate. Both pass structural verification. In the nested control “The label on the node under the oval should be Closed”, `on` and `under` both become spatial results and `Closed` becomes a group identifier. In the literal placement control “Move the node on the oval”, `on` can express real spatial position. These shapes need different roles despite sharing a preposition.

Canonical `property-frames.sop` already supplies `attribute` and `thing` in the question construction and `attribute`, `thing` and `value` in verb-led assignments. I propose reusing the same declared roles in a property-subject assignment with a resultative marker and a bounded colon assignment. The canonical frame should declare the construction act, the exact owner-marker part, the owner span and the value span. Allow candidate owner/attribute combinations from different families until the selected key and owner bind together. The existing reader can consume these roles in its token-local property binding. Literal placement remains a separate frame. Include the label cases in `diagram/ui-coverage.csv` and independent property controls such as width on a named node. Check that a nested `under` span and its oval stay selectors and that an actual next clause remains separate. This proposal is for the canonical language session and uses the existing request schemas.

## READY Q-NL-007 — Prefer a declared value among equivalent anchored relation candidates

Source baseline `be6d0b0`, canonical knowledge `ae80c054`, WebMeet `340eb4d`. `w.request.key.diagram.node.position` declares spatial values such as `next_to` and `below`. `w.request.key.diagram.node.relation` describes what a node stands for relative to another, including abstract roles such as a cause. The baseline lattice gave the same spatial cue and value to both keys. With their common anchor attached, either could lead even though one key provides declared value evidence.

- `diagram/nodes-01.csv` physical line 2477, “put in a diamond named Grind next to Sift”. Direct Diagram verification previously led with `node.relation=next_to`. It now leads with `node.position=next_to`, using exactly `next to` and landmark `Sift`, while keeping the new diamond and its `Grind` label.
- `diagram/nodes-12.csv` physical line 5631, “move the current one so it is below n4”. The baseline CLI selected `node.relation=below` in one request. The validated result uses `node.position=below` with `node.anchor=n4` and keeps the existing target. `current` remains unread and is a separate context-resolution issue.
- “set the relation on the node to cause” still binds `node.relation=cause` to the existing node as an explicit result. The distinct abstract question “what relation does the cause node have?” still asks for `node.relation`.

`src/smt/encode.mjs` compares only relations with the same family, cue span, operator and value, and a compatible family anchor candidate. When both an enumerated and an open slot offer that same anchored evidence, `declaredRelationValue` in `src/smt/weights.json` gives a six-point local preference to the declared value. This leaves open candidates satisfiable and leaves attachment phase to the other request constraints. A missing relationship or a separately keyed abstract value is outside this preference. The diagnostic switch at zero omits this preference.

`test/anchored-position.test.mjs` asserts the complete constraints, grounding, request ownership and both concrete and abstract results. Focused tests pass 4/4, `npm test` passes 80/80 and `git diff --check` passes. The dev audit at seed 1337 holds L1c at 62/250 and L3+L4 at 125/250 compared with Q-NL-004. This validates the local distinction without a measured dev score gain. It does not resolve missing relations when the solver reads an anchor as the target or represent independent landmarks for `between`. I request review of the three reader paths and the verified behavior.

## READY Q-NL-008 — Carry catalog types through modified creation phrases

Source baseline `93ccb43e0be84c29854ca552ba4ae0b7d4b09d79`, canonical knowledge `ae80c054`, WebMeet `340eb4d`. In the baseline Diagram CLI, `Make a new line chart with small marker size` emits an existing catalog wording within the target description `a new line chart`, plus the marker-size result. It emits no `chart.type` constraint and no typed target sort. The counterpart without `new` emits `chart.type=line`. The canonical request property is the chart layout (`w.diagram.group.layout`). In PSys2's declared execution policy the generic `w.chart.chart` creation binding uses a default bar layout, while `k.charts.kind.line_chart` has an explicit line binding. The baseline circuit preserves written evidence and loses the typed value. This is a review of the emitted contract and declared downstream bindings. Application execution has not been exercised in this batch.

`src/kb/load-worlds.mjs` carries the published determiner kind and meaning. `src/lattice/candidates.mjs` offers an additional candidate when a known multiword catalog type follows a declared creation modifier and a grammatically adjacent creation predicate. It retains the written modifier as part of the evidence. `src/contracts.mjs` shares the existing creation-type keys with `src/smt/encode.mjs`. The solver admits the extra candidate on a new target of its own family with an active creation predicate. It gives the typed interpretation a four-point preference over an untyped description when both compete, and favors the family supported by the explicit type phrase's head. Alternate typed interpretations remain in the solver.

The final CLI emits `chart.type=line words="new line chart"` alongside `chart.markerSize=small`, both results on one new chart. `new bar chart`, `new scatter chart` and `new mind map` emit their own declared values and exact evidence. The no-modifier line request keeps its type and marker size. A generic `new chart` keeps its untyped creation. In the quoted-name control, `New Line Chart` remains the naming result and the created type remains `bar`. The first test batch exposed the older compound ranking's unsupported alternatives on context-free families. The shared encoder now rewards that compound binding on its declared family when no separate owner is selected, while an explicit owner can still license compatibility. The alternate node-width reading is back in the top three.

Review paths are `src/contracts.mjs`, `src/kb/load-worlds.mjs`, `src/lattice/candidates.mjs`, `src/smt/encode.mjs`, `src/smt/weights.json` and `test/creation-type.test.mjs`. Focused creation and compound tests pass 15/15, `npm test` passes 88/88 and `git diff --check` passes. The historical dev audit keeps L3+L4 at 125/250 and changes L1c from 62 to 63. The typed creation repair is confirmed by the direct circuits. The batch shows no dev aggregate gain.

## Q-NL-009 — Keep development examples outside the measured holdout

On WebMeet `340eb4d`, the actual 1% sample at seed 42 contains 1,892 rows. The 250-row dev sample at seed 1337 shares two exact row identities and three exact utterance texts with it. Different seeds alone do not make the samples disjoint. I will route the dev audit and any affected development sampler through the existing benchmark selection and exclude the holdout utterances while preserving its original seed, sample size and grading. Historic dev figures used the former sampler. This evaluation repair is for trustworthy comparisons and does not change formalisation behavior or the target of over 90% L3+L4.

## READY Q-NL-009 — Development sampling excludes the exact benchmark utterances

`eval/benchmark.mjs` exposes the exact text set from its existing four-tab WebMeet selection at 1%, seed 42. `eval/audit-clusters.mjs` keeps the shuffled development order and replaces overlapping rows. `eval/calibrate.mjs` excludes the same texts before its existing reservoir selection. The holdout still uses the original selection, row count and grader. The separation is by exact utterance text across tabs, including same-text rows with differing annotations.

Verified against WebMeet `340eb4d`. The 1,892 holdout rows contain 1,889 distinct texts. The actual 320-row calibration sampler now has zero shared texts. I ran the full dev audit with the corrected 250-row sample, seed 1337, Z3 grading and ten workers. It yields 124/250 L3+L4 and 65/250 L1c. This is the refreshed dev baseline for subsequent reader changes. Existing calibration weights were generated earlier and have not been refit as part of the sampler change. `npm test` passed 88/88. Please review the three `eval/` paths.

## READY Q-NL-010 — Preserve frame ownership across coordinated predicates

Source baseline `47a114b`, canonical knowledge `ae80c054`, WebMeet `340eb4d`. In Diagram, “Set the width on the node to 15, then set the height on the chart to 20” produced two `place` requests with spurious spatial `on` constraints and emitted `node.height` for the chart. The baseline gave no property frame to either local clause. The nested variant “Set the width on the node under the oval to 15 and set the height on the node near the triangle to 20” gave one request with mixed relations and failed to bind both result properties.

`src/lattice/candidates.mjs` passes existing possible separators and licensed predicates to `src/lattice/frames.mjs`. A separator before a predicate offers extra clause-local frame windows alongside the existing whole-window matches. The matcher reserves one ranked match per observed start before filling the six-frame budget. `src/smt/encode.mjs` bounds a request to that window only when Z3 chooses the local frame. The underlying joiner and whole-window analyses remain available. Release probes produce two `change` requests with `node.width=15` and `chart.height=20`, and bind `under the oval` and `near the triangle` to their respective results in the nested example. A separate Drawing probe keeps the house and dog colour changes with their own landmarks. `Group A and B` stays one group request covering both IDs. `Build and Plan` stays one chart-title value.

`test/coordinated-frames.test.mjs` verifies the exact request spans, families, selectors, effects and ownership, plus the coordination and title controls. Focused tests 6/6, `npm test` 94/94 and `git diff --check` passed. Corrected dev sample with 250 rows at seed 1337 changes L3+L4 from 124 to 126 and L1c from 65 to 66. Shared-predicate ellipsis and a trailing `and undo` without a second frame remain separate failures.

The integrated standard 1% run with Q-NL-004/007/008/010 measured L0 49, L1 990, L2 195, L3 41 and L4 617. L3+L4 is 658/1,892 (34.8%), versus 659/1,892 in the pre-Q-NL-004 run, so it does not show an aggregate gain. L1c is 608 instead of 612. Diagram p95 was 6.12 s versus 5.09 s at that baseline. This comparison includes several reader changes and cannot attribute the latency or grade difference to the frame-window patch alone. Please review the four reader and regression paths for the verified local frame effect.

## READY Q-NL-011 — Reuse grounded numbers and measures in property frames

Source baseline `8b9bce6`, canonical knowledge `ae80c054`, WebMeet `340eb4d`. The old frame generated an untyped low-cost value for a property even when the key declares `head=number`. “Set the width on the node to 15 and undo” gave structurally valid `node.width="15 and undo"` and lost the undo command. “Set the width on the node to fifteen pixels” emitted the full phrase as a raw value, although the existing lattice had a `15`/`pixel` measurement over the same tokens. The Calendar baseline similarly wrote `meeting.duration="thirty minutes"`. The updated binder uses the independently recognized value over that exact span.

`src/lattice/frames.mjs` leaves numeric values and measures to `src/lattice/candidates.mjs` rather than generating a free-text setter for a numeric key. Within the same owner family, exact numeric property names also stop their looser aliases from synthesizing a free-text value. A quoted scalar is recognized through the same tokenizer and existing numeric parser. `src/smt/encode.mjs` requires a numeric equality value for these scalar property bindings and keeps compound effects from masquerading as one scalar. Other grounded operations such as degrees and deltas retain their existing eligibility. Free-text properties keep their written value spans.

The Diagram and Drawing width-and-undo cases now produce respectively width 15 and width 25, followed by a separate `undo` request. `fifteen pixels` produces `value=15 measure=15 unit=pixel` with the original measure words, `twenty five` produces 25 with its written evidence, the quoted `"15"` produces the scalar 15, and the Calendar meeting duration emits 30 with unit minute. `Build and Plan` remains one title value. The separate qualitative probe `whatever fits` still lacks a grounded numeric result and can select an incorrect fallback involving `node.size`. That is an open request-policy and unresolved-value path, outside this verified batch.

Focused `test/numeric-property-values.test.mjs` passed 8/8, `npm test` passed 102/102 and `git diff --check` passed. The 250-row disjoint dev run reports L1c 65 versus 66 at Q-NL-010 and L3+L4 125 versus 126. These runs confirm the numeric cases and do not show an aggregate dev gain. Please review the three reader paths and the regression test.
## READY Q-NL-012 — Bind the spatial description of the edited object

Source baseline `616e29f`, canonical knowledge `3b2deebd`, WebMeet `3d13d9b`. The shared `acts.change.value` construction already declares a thing and an independently licensed value. The loaded grammar has no static lexicon named `value`. The reader now uses existing closed-value and colour evidence to fill that slot when the thing span contains a target head, a relational cue and a same-family landmark that completes the span. `src/lattice/frames.mjs` uses the same span test as the existing property-owner binding in `src/smt/encode.mjs`. The result uses the exact independently grounded value span, and a local soft preference rewards an attribute on the same family as the selected relation. Other readings remain solver hypotheses. There is no change to shared vocabulary or schema.

| Verified Diagram or Drawing probe | Prior lead | Current lead |
| --- | --- | --- |
| Paint the node below n4 red | Edit existing named `n4` | Edit the existing node with `position=below` and `anchor=n4` as selectors, `colour=red` as the result |
| Paint the rectangle near the triangle green | Make a new rectangle with a spatial result | Edit the existing rectangle selected by `near` and `triangle`, with `colour=green` as the result |
| Paint the house near the cabin green | `drawn.near` attribute result | Select the existing house by `drawn.relation=near` and `drawn.anchor=cabin`, with `colour=green` as the result |
| Make the rectangle under the oval blue | `position=below` result with landmark `oval blue` | Select the rectangle below `oval`, with `colour=blue` as the result |

Controls include the literal edit `Paint n4 red`, `Move the node below n4` with spatial result, and the distinct Drawing relation and complete `light blue` value in `Paint the house behind the tree light blue`. Focused property, spatial and described-owner checks passed 20/20 before tightening the lexical match. The final `npm test` passed 110/110. One preceding run hit a transient Z3 parse error in `test/spell.test.mjs`; the full rerun passed. `git diff --check` passed. No aggregate measurement for this batch. Open-ended qualitative values and arbitrary nested owner descriptions remain outside the new binding. I request review of `src/contracts.mjs`, `src/lattice/{candidates,frames}.mjs`, `src/smt/{encode.mjs,weights.json}` and `test/described-owner.test.mjs`.

## READY Q-NL-013 — Keep compound measures complete and retain an unresolved change duration

Baseline `2b6ece7`, canonical knowledge `3b2deebd`, WebMeet `3d13d9b`. `Set the duration on the meeting to forty five minutes` previously led with a raw `forty` duration and a separate `5` minute length. The same existing number composition now supplies the unit binding with the compound end token and normalized value. The leading circuit holds one `meeting.duration=45` minute result with `measure_words="forty five minutes"`. The hyphenated `forty-five minutes`, `sixty seven minutes` and `45 minutes` controls respectively yield one 45, 67 and 45 minute result, preserving each exact phrase.

`Set the width on the node to 15 for 2 minutes` previously led with spatial `on`, an anchor and `page.duration=2` alongside the width. It now has one existing-node `change` request with `node.width=15` and the exact `w.request.unread` text `for 2 minutes`. A named-owner numeric frame can select the complete typed value preceding the temporal phrase. It retains the unresolved phrase only within that frame's request. The independent `fifteen pixels for two minutes` probe preserves `node.width=15` in pixels and `for two minutes` as unread. `Set the duration on the page to 2 minutes` still uses explicit `page.duration=2`. `Review 2` stays a chart name in its measured height edit. A following `make 2 circles` keeps count 2 on its new target.

The request schema currently has no slot for the duration of this change. Page marks and meeting length have their own slots. If the application supports temporary property effects, please route a separate request-scoped duration contract and review expiry/undo semantics with its executor. This batch preserves the written qualifier and makes no application-execution claim. The final `npm test` passed 119/119 and `git diff --check` passed. No aggregate measurement was run. I request review of `src/lattice/{candidates,frames}.mjs`, `src/smt/encode.mjs` and `test/numeric-property-values.test.mjs`.

## READY Q-NL-014 — Retain a literal value through weak command boundaries

Baseline `7753357`, canonical knowledge `3b2deebd`, WebMeet `3d13d9b`. `Set the title on the chart to Plan and Build, then set the width on the node to 17` previously led with a chart named `Build` and `chart.title=Plan`, then a correct separate node-width request. The leading circuit now selects the existing chart by its written family, gives it exactly `chart.title="Plan and Build"`, then assigns only `node.width=17` to the separate existing node. Each request retains its exact written extent.

The matcher offers an additional window through a weak joiner only when the skipped boundary is wholly inside a complete value role and the declared property takes a literal `span`. It preserves the other windows as candidates. Punctuation and strong joiners remain boundaries for the added windows. This uses the existing property frames and schema, without new language facts. Quoted values on span properties use their inner text as the value and retain the quoted evidence in the raw request.

The literal controls reverse the words, quote the title, vary the following owner/property and use `node.label="Save and Publish"` followed by a chart-height edit. Two bare `and` joiners still keep the chart title and the distinct following property edit. `Plan and then undo` leaves an actual undo request; the ambiguous bare `Ready and undo` can still lead as a literal title. The long-scope clauses and shared-predicate ellipsis remain separate tasks. The full `npm test` passed 124/124 and `git diff --check` passed. I request review of `src/lattice/frames.mjs` and `test/coordinated-frames.test.mjs`.

## READY Q-NL-015 — Load canonical weather values and time-of-day vocabulary

Source `e122ad5` plus the current reader changes, canonical `3b2deebd`, WebMeet `3d13d9b`. `src/kb/load-worlds.mjs` indexes `core.word` aliases by their `of` slot and applies them only to a request key with matching `means` and a declared value. The published Drawing weather terms now resolve without the superseded private mappings. The baseline gave `fog` for `misty`, `wind` for `breezy` and open `hazy`. The new outputs are `mist`, `breeze` and `haze`. `foggy`, `windy`, `overcast`, `frosty`, `icy` and `rainy` use distinct closed values. A composite phrase containing a time term no longer enters the closed weather index as a weather alias.

`src/lattice/candidates.mjs` now also uses the existing `k.time` vocabulary for `page.time`. The published WebMeet row `change the weather to a rainy nightfall` previously led with the open weather value `rainy nightfall`. It now leads with one existing-page change, `page.weather=rain` and `page.time=dusk`, with exact `nightfall` evidence on the time constraint. `Set the time to nightfall` reads dusk directly, and `Make a rainy day scene` still selects the named scene. The broader `turn the scene into a bright sunny afternoon` still leads with an open scene value. That construction remains part of Q-NL-005.

The three retained legacy weather forms `raining`, `snowing` and `thunderstorm` lack equivalent slot-owned declarations in the loaded canonical vocabulary. Please review `core.word of=w.drawing.page.weather` candidates with `means=rain`, `means=snow` and `means=storm`, respectively, using explicit weather settings and the separate named-scene controls. `thunderstorm` already helps identify a catalog scene in `k.scenes`; the explicit weather operand supplies the context for its weather sense. No new private mappings were added. Focused behavior is covered in `test/weather-vocabulary.test.mjs`, full `npm test` passed 135/135 and `git diff --check` passed. I request review of both source paths and the test.

## MEASUREMENT — WebMeet 1% through Q-NL-014

Reader `e122ad5`, canonical `3b2deebd`, published WebMeet `3d13d9b`, seed 42, tab-agnostic, Z3 grading, at most 8 proposals and 2 per tab, 10 workers, spelling/confidence off. The first attempt saw 1,893 rows because of a concurrent WebMeet draft. I stopped it and reran against the committed CSV snapshot, with 1,892 rows. The completed run contains L0 47, L1a 144, L1b 89, L1c 610 (23 spelling, 587 other), L1d 147, L2a 29, L2b 72, L2c 98, L3 43 and L4 613. L3+L4 is 656/1,892 (34.7%), versus the earlier aggregate 658/1,892 (34.8%) on older published knowledge/data. This run shows no aggregate gain and predates Q-NL-015. It does not isolate an individual patch's effect. At least 1,703 accepts are needed for the user's target. `L1-Issues-plan.md` has the displayed distribution.

## MEASUREMENT — WebMeet 1% through Q-NL-017

Reader code `a6ed12b`, canonical `3b2deebd`, published WebMeet `3d13d9b`, with the same options and 1,892 rows as the Q014 measurement. The completed run contains L0 46, L1a 143, L1b 96, L1c 603 (23 spelling, 580 other), L1d 148, L2a 30, L2b 75, L2c 93, L3 39 and L4 619. L3+L4 moved from 656/1,892 (34.7%) to 658/1,892 (34.8%). L1c fell by seven and L1b increased by seven. The pair measures the integrated batch, and individual changes have separate focused checks. Document p95 was 12.41 s versus 7.88 s on the preceding run. This is an observed timing difference without an isolated cause. The 556 automatic reference flags remain subject to independent review. `L1-Issues-plan.md` shows the current table.

## Q-NL-016 — Independently audit reference annotations and the remaining role errors

The completed 1% run flags 558 differences as `fail_gold_annotation_flawed`, and the signals include uncovered words, reference unread and filler misuse. A flag alone cannot assign responsibility or establish a score ceiling. Please route a stratified sample for independent review on the disjoint development data, with complete utterance and circuit. For each row, identify the requested effects, owners and evidence spans before comparing the reference and model. Report confirmed annotation errors, reader errors and supported alternate readings with exact row identities, and send canonical gaps through the existing schema protocol. Keep the 1% membership and grading rules fixed while investigating. The reader lane will pursue the distinct-owner/shared-predicate cluster with authored controls and a disjoint quantitative cohort.

## Q-NL-017 — Coordinate two complete owner/value clauses with one predicate

Reader `7ff9a64`, canonical `3b2deebd`, WebMeet `3d13d9b`. In Drawing, `Make the house red and the door blue` currently emits both colour results on the house and `door` unread. In Diagram, `Paint the node red and the arrow blue` currently emits a single mixed node/arrow target with red selector and blue result. The request needs one existing owner and one result per coordinated clause, with predicate evidence written only in the first clause. The separate `Paint the door and the window blue` case has a shared trailing result and belongs to `coord.shared-suffix`; it needs its own effect-distribution mechanism.

`variants.sop` explicitly maps `acts.more.change.short` to `acts.change.value` by `verb ellipsis`. Both frames declare `thing` and `value`. `grammar.sop` declares the coordination separator inventory. The reader can offer the written-predicate frame and its declared verb-free variant as a joint hypothesis only where each side has an independently grounded owner and value. `Set the title on the chart to Build and Plan`, one owner with coordinated modifiers, and ordinary explicit-predicate coordination serve as controls. No schema additions are needed for two local `change` requests. I request review of the proposed scope and independently annotated pairs for the disjoint development set if available.

## READY Q-NL-017 — Bind the two written owner/value pairs under a shared verb

Reader baseline `7ff9a64`, canonical `3b2deebd`, WebMeet `3d13d9b`. The loader retains the canonical verb-ellipsis variants and coordination separators. The matcher pairs complete written-predicate and verb-free frame instances only when the canonical relation licenses them and each side can fill its own owner and typed result. The solver offers that joint reading beside the ordinary readings. It selects the original predicate on the first request and requires both adjacent requests to own their own effects. The second request carries its full written owner/value evidence and no borrowed predicate text.

`Make the house red and the door blue` now leads with two existing Drawing owners, house/red and door/blue. `Paint the node red and the arrow blue` leads with existing node/red and link/blue. A distinct-chart control also preserves the following explicit undo. The single-owner `Paint the house red and blue`, explicit-predicate coordination and literal title controls retain their readings. The clothing descriptions in `flip the man in the blue shirt and the man in the green shirt` do not create a coordinated property-change hypothesis.

The targeted disjoint comparison excluded every seed-42 holdout text, used the same committed WebMeet revision for both readers, and selected records matching the new candidate shape before grading. Five Drawing records matched the filter after screening 11,205 distinct candidate utterances across Drawing and Diagram. No Diagram row met that filter. Existing tab-agnostic Z3 grading improved from 0/5 to 3/5 L3+L4. `drawing/people-03.csv#46`, `drawing/scenes-03.csv#792` and `drawing/scenes-03.csv#1114` move L1d→L4. The pink/orange gradient and the smile/frown case retain their grades. The separate 1% run through Q017 is recorded above.

The final `npm test` passed 141/141, and `git diff --check` passed. One earlier run hit an intermittent SMT parser error in an unchanged numeric control and a fresh full run passed. Shared trailing values, longer nested selectors and open-valued effects remain open. I request review of `src/kb/load-worlds.mjs`, `src/lattice/{candidates,frames}.mjs`, `src/smt/{encode.mjs,weights.json}`, `src/emit/to-sop.mjs` and `test/coordinated-frames.test.mjs`.

## Q-NL-018 — Preserve both targets when one written value applies to them

`Paint the door and the window blue` currently leads with a single edit on the door. `coord.shared-suffix` already declares the grammatical reading of one shared trailing result per coordinated owner. I tested two representations with the reader at `a6ed12b`, canonical `3b2deebd` and PSys2 `c6b87bb09`.

One `change` request with two distinct `w.request.target` wires (`sort=door`, `sort=window`) and one owned `drawn.colour=blue` result passes `createVerifier().check` with zero errors or warnings. I round-tripped that exact circuit through `psys2/official-dataset/sop_dataset.py` using `parse` and `render`. The parsed singleton `target` contains only `window`, and the rendered circuit drops `door`. Two independent narrow request spans with the shared value copied into both fail verification because `blue` is outside the first request's written span.

Please route the multi-target interpretation through the shared request, codec and executor owners. Confirm the intended representation and preserve each target and the scope of its shared result through a codec round trip and actual application. Include the same effect on two IDs, distinct owner types, and one owner with separate modifiers as controls. The reader can then implement the canonical interpretation and its evidence rules. I did not modify either repository or publish an executable multi-target request. Q017 already handles two owner/value pairs whose results each have their own written evidence.

## Q-NL-019 — Check the finite value contract of an ownerless property edit

Reader `a6ed12b`, canonical `3b2deebd`. The Diagram command `Make the width medium` matches the published `context.make.property` frame but emits `page.fit=width` and `node.gap=medium`, both as results. The frame's `needs=values` requires the operand to be declared for the property. For exact `width`, the loaded Diagram candidates are numeric `chart.width`, `link.width`, `node.width` and the size alias `node.size`. None declares `medium`. `Make the grid width medium` does produce `chart.gridWidth=medium` from a declared value, `Set the width to 15 pixels and undo` keeps its measured width and separate undo, and `Change the orange to red` is a genuine existing-object edit. Drawing `Make the width medium` currently produces `drawn.size` with degree `medium`; its native action mapping needs independent confirmation against the imported frame's finite-value condition.

Please check whether the unqualified `width medium` example is intended to remain unresolved, name a default scale operation on a compatible existing object, or show a concrete class-valued key such as `grid width`. If a degree-to-width operation is intended, specify its slot/family and execution contract. The reader should keep the property evidence and admissible alternatives without inventing a fit or gap effect. This proposes a shared-contract decision while normal explicit numeric and finite-value controls continue to apply.

## READY Q-NL-020 — Preserve grounded spatial selectors on existing targets

In Drawing and Diagram, an explicit selecting predicate at a clause edge now favors the written owner, same-family relation, and landmark together. `Describe the cat below the bench` and `Remove the cat under the table` set the relationship's phase to `selector`. `Select the node below n4` retains a contextual node as owner and uses `n4` only as its landmark. `Select the node in front of n7` retains the full declared relation instead of attaching `in` to `front`. `Select n4` still selects that exact ID, and `Move the node below n4` retains a spatial result. The mixed pick and move control checks both requests independently. The preference is soft and excludes interior verb homonyms in values and predicates licensed for both selection and effects.

The shared verb lemmatizer now falls back to productive `re-` stripping only when the declared lexicon has no ordinary reading. This keeps `remove` and `removed` separate from `move` and still admits the `paint` stem for `repaint`. The change reuses the canonical verb entries and the existing grounded spatial matcher. No schema or corpus content changed.

All 151 tests pass with `node --test --test-concurrency=1 test/*.test.mjs`. Parallel reruns intermittently produced malformed SMT input errors on unrelated existing fixtures. On the 300-row development sample pinned to WebMeet `833ddc8` and canonical knowledge `3b2deebd`, 18 rows had changed candidates or SMT compared with reader `1ec3400`. The accepted count in those rows stayed at 8/18, with one L1d to L1c change. Unchanged SMT also produced different proposals in preliminary reruns, so the affected rows are reported here and the full 1% result remains the previously recorded run.

The disjoint row `drawing/scenes-09.csv` record 1245 now emits both spatial clauses as selectors. The grader still reports L1c for that row, where the reference encodes `by` as an open relation and includes the article in the landmark. The reader emits canonical `near` with written evidence `by`. Weak coordinators consumed into an open landmark, for example before `and paint it blue`, still need separate boundary handling. Please review the spatial ownership preference and the lexical fallback change.

## READY Q-NL-021 — Apply a shared trailing result to independently identified targets

This is the separable-effects follow-up to Q018. The reader loads `coord.shared-suffix`, identifies independently written owners and a common typed result, and submits each prefix–owner–suffix projection to the existing Z3 solver. It selects the shared reading only when each projected result identifies a different existing target, applies the same compatible property and value, and produces a complete verified circuit. The prior reading remains available as an alternative. The output retains one written predicate and one target per request. Each request uses an exact `words_origin=hull` span, with whole-message spans implicit and later spans beginning at the individual owner.

Seven emitted circuits survive `parse` → `render` → `parse` in the PSys2 codec at `c6b87bb09` with the normalized graph stable and zero native errors or warnings after rendering. The probes include two IDs, chart and node, a three-target list, degree, and a quoted name with a separate code. WebMeet `bacd7fb` Drawing record `people-01.csv:46` also retains `hair_back`, `eyebrow` and `hair_front` with one `dark brown` result each. Its reference encodes the entire list as a `part.ids` result. This direct behavior was verified without assigning the row a new benchmark grade. Modifier lists, literal titles, explicit second verbs, conditional scopes and `in a column` arrangements retain the ordinary reading path. There was no new 1% run.

The full serial suite passes 168/168 with canonical `3b2deebd`. The codec probe used the coordinator checkout, which also contains an independent diagnostic for the unsupported two-target single-request form.

Please review the separability and source-span rules. A leading ID followed by a different proper name still falls back to the ordinary reading because the first request's hull covers both names and the existing per-request checker warns. The codec can also infer a `name_words` marker from the wrong owner in that broad span. Tighter later spans avoid that leakage in the tested name-first example. Group effects and sequence-wide application behavior remain open.

## READY Q-NL-022 — Bind context properties to declared values and preserve unresolved measures

The reader consumes the published context-property frames and checks that the complete value belongs to the written property before constructing a typed result. It binds the keyword, value and owner family within the same request. `Make the width medium` in both Diagram and Drawing preserves exact `width medium` as unread on an existing context target. Diagram proposals keep compatible node, chart and link families available without emitting a fit, gap or size edit. `Set the width to whatever fits and undo` retains the exact unresolved phrase and emits the independent undo. Measured and quoted scalars, `grid width=medium`, `colour bar length=medium`, a literal label and a genuine existing object colour edit pass. Complete structure is reserved across a following directive so the shorter match survives even when generic frames fill the ranking budget.

An earlier draft also converted unrecognized finite-property phrases to unread. The disjoint regression `change the time to after sunset` exposed the loss of a legitimate reading, and `make all corners rounded` exposed an object/quantifier collision. The final fallback triggers only for an exact, numeric-only property phrase. Both regressions retain their prior readings. Grounded finite results still use the new binding. This does not supply an execution policy for relative widths or interpret arbitrary qualitative phrases. Please review the property/family binding and the narrowed unresolved fallback.

On the pinned 26-record development cohort from WebMeet `23f19aa`, selected from a seed-1337 property-frame screen with every exact seed-42 1% text excluded, the existing tab-agnostic Z3 grader still accepts 17/26, compared with reader `b3b95f8` and the same canonical `3b2deebd`. Fourteen records activate a new context match in their gold tab, all accepted in both runs. Three move L4→L3 and one L3→L4 in that subset. This does not supply a score increase or a new 1% run.

The PSys2 codec at `ba8017ea5` requires the frame name on unread wires. The new unresolved output records the exact originating frame in `note`. Five actual circuits survive parse → render → parse and reverify with zero errors. The three unresolved circuits keep their unread warnings and zero unsupported effects. The two supported circuits reverify without warnings, and both undo controls keep the second request. Full serial suite 182/182 and `git diff --check` pass.

## Q-NL-023 — Preserve directive negation and a coordinated owner's exclusion

The Q021 follow-up has two distinct source scopes. `Do not paint the door and the window blue` has a directive-level prohibition. The published `neg.imperative` declaration says the action is not carried out. The existing request schema has no directive polarity slot and the PSys2 dataset codec does not retain request `status`. `Paint the door and not the window blue` allows the blue edit on the door and excludes the window as a target. A negative colour result on the door changes the wrong meaning. Please confirm an existing representable directive no-op and an owner-exclusion evidence form that survive the codec, or route a shared contract for the missing forms. The comparison controls are `Paint the door and the window blue`, `Paint the door red, not blue`, a quoted name containing `not`, and `Do not paint the door blue, then paint the window green`.

## READY Q-NL-024 — Preserve unrepresented directive prohibition at the reader boundary

This handles the directive half of Q023 during canonical work. The reader loads `neg.imperative` and its declared exceptions, records the original text and offsets, and prevents Z3 request ranges and candidates from consuming that scope. A standalone prohibition returns `unknown`, no SOP and exact `unresolved` evidence. An independently written affirmative directive can still produce a `partial` result, with its own tight SOP span and the same diagnostic on every proposal. The CLI reports the unresolved source. An unqualified coordination within the prohibition remains in its scope. The punctuation boundary requires a following written directive and the comma-only case requires a base verb and an overt continuation. Negative property values and quoted names retain their existing paths. When a spelling correction exposes a prohibition, its diagnostic is projected back to the raw text.

In the mixed door/window control, only the green window circuit is emitted. The native verifier accepts that circuit and flags the unresolved words as uncovered. The unresolved API field has no SOP equivalent. Current WebMeet `23f19aa` direct probes at `drawing/scenes-05.csv:914` and `drawing/people-08.csv:164` expose the previous prohibitions with no emitted edit. `diagram/nodes-05.csv:1094` and `diagram/diagrams-01.csv:2538` keep their independently written `move` spans. Those two moves still have downstream owner/attachment errors. The full serial suite passes 195/195. No new 1% run or score gain is claimed.

Please review the partial API behavior, raw offsets and mixed-scope controls. The target contrast `paint the door and not the window blue` remains open and can still drive an incorrect negative colour on the door. The library already declares `std.request.polarity` in `soplang-words-lib/src/contracts.mjs`, which gives the data lane an existing declaration to evaluate. The current closed `w.request.request` contract lacks that binding. This does not establish how an executor handles a prohibited request.

## Q-NL-025 — Relative time-of-day as a property result

Reader `c4482df`, canonical `3b2deebd`. `Change the time to after sunset` emits `page.time=sunset` with `operator=eq`. WebMeet `23f19aa` Drawing record `scenes-13.csv:4502` has the same equality, with `words="after sunset"`. Records `scenes-08.csv:2365` and `scenes-08.csv:2371` have the same mismatch. The evidence text alone does not convert an equality to a relation.

`pp.time` and its published temporal prepositions ground `before` and `after` in opposite orientations of `k.time.before`. Native validation accepts `on=attribute attribute=page.time value=sunset operator=relation relation=after phase=result words="after sunset" key_words=time` with zero errors or warnings. The published `w.request.constraint` documentation describes `operator=relation` for a place and its landmark. I found no declared consumer meaning for this shape on `page.time`. Please confirm that it is the intended relative property representation or route the native binding. Compare at-sunset equality, before dawn, later than noon and an ordinary spatial landmark. Until supported, the reader will keep the relative property expression as exact `unread` evidence instead of selecting an exact time.

## READY Q-NL-026 — Retain relative operands and the available Z3 proposal

Explicit time changes now keep relative operands in request-owned `unread` with `note=pp.time`. The reader uses the declared temporal preposition and the full operand, including omitted connectors, qualifiers such as `just`, and distances such as `three minutes after sunset`. Drawing preserves page-time requests, and Calendar preserves a time-of-day boundary when the clock or named period is independently recognized. Exact `at sunset`, `nightfall`, spatial landmarks, document order, and Calendar meeting-to-meeting relations retain their existing representations. A separately written edit keeps its own request. If `maxRequests` is too low for explicitly separate relative settings, the solver reports that it has no satisfiable graph for the cap.

Text-only auto mode with no previous turn, clock or selected tab now ranks the typed `after sunset` reading in Drawing and `after 2pm` in Calendar ahead of incidental word matches. Other domain proposals remain available. The actual WebMeet `23f19aa` Drawing record `scenes-13.csv:4502` uses the Drawing proposal with exact `time to after sunset`, zero native errors and the expected unread warning. This preserves the written ordering as evidence while its native result binding is pending in Q025. The published reference still expresses equality. Implicit or free-form phrasings such as `make it after sunset` still need a supported role binding. No new 1% run or aggregate gain is claimed.

The direct case also exposed a general Top-K failure. Asking for two semantically distinct proposals when only one model exists reached `unsat`, then the batched `get-value` emitted `model is not available`. The runner previously returned an error and discarded the model it already had. It now returns the available proposal and distinguishes expected exhaustion from malformed SMT. A truly malformed solve recreates its private context before accepting subsequent work. The full serial suite passes 211/211 and `git diff --check` passes. Please review the native scope evidence, the text-only ranking and the solver regression.

## READY Q-NL-027 — Preserve a written object reference and its argument role

The current Z3 reader returns an unlabeled `key=thing from=page` lookup for `Make it red`, `Cancel it`, and `Paint them blue then move them left`. The exact reference is lost in the circuit. `Move the cat next to it` can also lose the whole landmark phrase while passing native validation because the dropped words are grammatical. For unresolved references I propose using the existing `w.request.lookup.words` evidence and `from=any` when no source is given. An object reference belongs to the target lookup. A pronominal landmark belongs to the lookup on its own anchored constraint, with the written operand kept as a reference. The canonical lookup already supports `target`, `constraint`, `key=thing`, and `words`. No name, identity, explicit local antecedent, or prior turn should be inferred. Please review those bindings, with named targets, possessive descriptions, quoted names, and successive independent requests as controls.

The Z3 reader now emits `key=thing from=any` with exact words on the target lookup for a written object reference. A spatial landmark lookup points to its own anchor constraint. `Move the cat below that one` keeps the cat as target and `that one` as landmark. `Paint the cat next to it red` keeps the relation as a selector for the colour edit. The property frame for `Make its width 15 pixels` attaches `its` to the unresolved target and keeps the written key and measure on the result. Named and quoted `It`, demonstrative determiners and numeric `one` retain their distinct roles. A four-clause hierarchical solve verifies that each anchor lookup refers to its own renumbered constraint. The verifier also rejects lookup evidence borrowed from another request.

I used the actual text-only reader on six published WebMeet records at `23f19aa`, without a selected tab, clock, or previous input. The native checker accepts all six corresponding-domain circuits. Drawing `placement-03.csv` record 74 attaches `them` to the bench's landmark. Diagram `nodes-02.csv` record 598 retains `its` on the height change and `it` on the move. Calendar record `meetings-06.csv:13` preserves `it` in the Calendar proposal, ranked after Document. One circuit reports unread evidence. The nested Drawing scene `scenes-15.csv:247` has two spatial references and the circuit retains only one lookup. This probe measures structural conformance and written evidence. The evaluator's lookup comparison does not grade exact words or ownership on its own.

The focused tests pass 7/7 and the serial suite passes 218/218. Please review these circuits and the frame/SMT binding. Possessive part owners such as `its roof`, open-valued property owners such as `Set its label to Intake`, and the source argument of `Draw it as a fox` still need role binding. A following `it` stays unresolved where no supported concrete referent is projected. No new 1% score is claimed.

## READY Q-NL-028 — Bind the written owner of a drawn part

`Make its roof red` currently changes a standalone roof and drops `its`. `Paint the roof of the house red` can read `house red` as the owner and drop the colour result. `Make her hair shorter` identifies the part and the length change, but drops `her`. The canonical `part.owner` slot names the owner of a part. I propose binding this selector to a part head grounded by the existing part vocabulary and a written possessive determiner, genitive, or `of` noun phrase. A pronominal owner keeps its exact words and uses `key=thing from=any` on the owner constraint. A written nominal owner supplies only its own span. No component label by itself implies an owner, and a standalone object remains a supported reading when the wording supports it. Please review the binding against `people-07.csv`, `scenes-24.csv`, the standalone roof, and a genuine placement such as `Move the roof next to the house`.

Implemented with the loaded part names and the declared possession preposition. The selected owner and component head share one request. `part.owner` is a selector for an existing part and a result when a declared creation predicate makes a new one. Coordinated components retain each written owner or share a single written possessive where it governs both. When a property frame takes a part with its own possessor, it consumes the complete owner before the result. Explicit keyed effects can share that component, while a following directive keeps a separate request and a literal such as `Save and Close` remains intact.

I compared twelve published rows from WebMeet `23f19aa` with `4ad17ed` using the initialized Z3 reader in text-only auto mode. All twelve emitted Drawing candidates now have `part.owner` and pass the native WebMeet checker. The four `people-07.csv` commands attach the exact `her` or `its` to an owner lookup from `any`. In `scenes-24.csv` record 679 the selector is `the house` and the colour is teal, replacing an output that treated `of the house to teal` as the colour. Records 708, 716 and 718 preserve both written results on the same component. Drawing leads in ten of the twelve, and Diagram still leads in 708 and 716. One Drawing row has a warning for unread text in `trim her hair shorter`. These are targeted native and role checks. No new WebMeet 1% aggregate was run.

The full serial suite passes 224/224, including the written-owner, shared-effect, and nested-property regressions. Please review the complete emitted circuits, standalone-object and spatial controls, and the use of a selected `part.owner` as additional domain evidence while retaining compatible alternatives.

## EVIDENCE Q-NL-016 — Twelve disjoint development cases for independent review

Reader commit `7ff9a64`, canonical `3b2deebd`, published WebMeet `3d13d9b`. The existing dev selection uses seed 1337, first 250 after excluding every exact text in the seed-42 1% holdout. The existing tab-agnostic Z3 grader selected the displayed emitted proposal, with up to eight proposals and two per tab. File identities use CSV record numbers including the header. These are reviewer inputs. Flag names and grades are automatic diagnostics awaiting independent adjudication. Some cases have grade L4 because semantic equivalence can accept a proposal while the reference diagnostics still flag its comparison.

### Case 1 — `diagram/nodes-02.csv#3458`

Stratum `gold_hull_overlap`. Grade `L1b`. Flags `gold_left_unread`, `gold_hull_overlap`.

Original utterance

````text
use two-line spacing for the body content, then group it with the box
````

Published reference

````sop
@f1 w.request.filler text=then
@r1 w.request.request act=change mood=do predicate=use
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=description sort=text sort_words=content description="the body content"
@r1.u1 w.request.unread request=$r1 text="two-line spacing" note=node.lineSpacing value=double
@r2 w.request.request act=group mood=do words="then group it with the box" predicate=group
@r2.t w.request.target request=$r2 family=node mode=existing determiner=definite fill=description description=it family_words=box
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=place mode=arrange mood=do words="use two-line spacing for the body content" predicate=spacing
@r1.t w.request.target request=$r1 family=chart mode=existing determiner=definite fill=context
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.measure value="body content" operator=eq phase=result
@r1.u1 w.request.unread request=$r1 text="use two-line"
@r2 w.request.request act=group mood=do words="group it with the box" predicate=group
@r2.t w.request.target request=$r2 family=node mode=existing determiner=definite fill=context family_words=box
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
````

### Case 2 — `diagram/nodes-04.csv#111`

Stratum `gold_hull_overlap`. Grade `L1c`. Flags `gold_uncovered_words`, `gold_hull_overlap`.

Original utterance

````text
here is the plan: a braid diagram with over and under crossings, plus label the two strands, so it still fits on a single slide without crowding
````

Published reference

````sop
@f1 w.request.filler text=so
@r1 w.request.request act=make mood=do predicate=label
@r1.t w.request.target request=$r1 family=diagram mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=diagram.kind value=braid words="braid diagram" operator=eq phase=result open_value=true
@r2 w.request.request act=change mood=do predicate=label
@r2.t w.request.target request=$r2 family=node mode=existing determiner=quantified fill=all
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=node.label value=strand words=strands operator=eq phase=result
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do words="here is the plan: a braid diagram with over and under crossings"
@r1.t w.request.target request=$r1 family=diagram mode=new determiner=indefinite family_words=diagram description="a braid diagram"
@r1.c1 w.request.constraint request=$r1 on=place attribute=node.position value=below words=under operator=relation phase=result
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.anchor value=crossings operator=relation phase=selector
@r1.u1 w.request.unread request=$r1 text=plan
@r2 w.request.request act=change mood=do words="label the two strands"
@r2.t w.request.target request=$r2 family=node mode=existing determiner=definite fill=context
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=node.label value="two strands" operator=eq phase=result key_words=label
@r3 w.request.request act=place mood=do words="so it still fits on a single slide without crowding"
@r3.t w.request.target request=$r3 family=node mode=existing determiner=definite fill=context
@r3.l1 w.request.lookup request=$r3 target=$r3.t key=thing from=page
@r3.c1 w.request.constraint request=$r3 on=place attribute=node.position value=on operator=relation phase=result
@r3.c2 w.request.constraint request=$r3 on=place attribute=node.anchor value="single slide without crowding" operator=relation phase=selector
@r3.u1 w.request.unread request=$r3 text="still fits"
````

### Case 3 — `diagram/diagrams-03.csv#3571`

Stratum `gold_hull_overlap`. Grade `L1c`. Flags `gold_left_unread`, `gold_hull_overlap`.

Original utterance

````text
insert a picture, set height 6 cm, place it in the right corner and keep everything inside the page margins
````

Published reference

````sop
@r1 w.request.request act=make mood=do predicate=insert
@r1.t w.request.target request=$r1 family=node mode=new determiner=indefinite sort=picture description="a picture"
@r2 w.request.request act=change mood=do words="set height 6 cm" predicate=set
@r2.t w.request.target request=$r2 family=node mode=existing determiner=definite fill=context
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=node.height value="6 cm" operator=eq phase=result key_words=height
@r3 w.request.request act=place mode=arrange mood=do words="place it in the right corner" predicate=place
@r3.t w.request.target request=$r3 family=node mode=existing determiner=definite fill=context
@r3.l1 w.request.lookup request=$r3 target=$r3.t key=thing from=page
@r3.c1 w.request.constraint request=$r3 on=attribute attribute=node.x value=right words="the right corner" operator=eq phase=result
@r3.c2 w.request.constraint request=$r3 on=attribute attribute=node.y value=top words="the right corner" operator=eq phase=result
@r4 w.request.request act=place mode=arrange mood=do words="and keep everything inside the page margins" predicate=keep
@r4.t w.request.target request=$r4 family=page mode=existing determiner=definite fill=context family_words=page
@r4.l1 w.request.lookup request=$r4 target=$r4.t key=thing from=page
@r4.u1 w.request.unread request=$r4 text="the page margins" note=node.margin value="page margins"
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do words="insert a picture" predicate=insert
@r1.t w.request.target request=$r1 family=node mode=new determiner=indefinite
@r1.u1 w.request.unread request=$r1 text=picture
@r2 w.request.request act=place mood=do words="set height 6 cm, place it in the right corner and keep everything inside the page margins" predicate=set
@r2.t w.request.target request=$r2 family=node mode=existing determiner=quantified fill=all quantifier=everything
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=node.height value="6" operator=eq phase=selector measure=6 measure_words="6 cm" unit=cm key_words=height
@r2.c2 w.request.constraint request=$r2 on=attribute attribute=node.keep value=place operator=eq phase=selector
@r2.c3 w.request.constraint request=$r2 on=place attribute=node.position value=in operator=relation phase=selector
@r2.c4 w.request.constraint request=$r2 on=place attribute=node.anchor value="right corner and keep" operator=relation phase=selector
@r2.c5 w.request.constraint request=$r2 on=place attribute=node.position value=in operator=relation phase=result
@r2.c6 w.request.constraint request=$r2 on=place attribute=node.anchor value="page margins" operator=relation phase=selector
````

### Case 4 — `diagram/diagrams-01.csv#1439`

Stratum `gold_bad_filler`. Grade `L4`. Flags `gold_bad_filler`.

Original utterance

````text
next snap Approve and Ship to the same bottom line so the gap above them is even
````

Published reference

````sop
@f1 w.request.filler text="so the gap above them is even"
@r1 w.request.request words="next snap Approve and Ship to the same bottom line" act=place mode=arrange mood=do predicate=snap
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=written name=Approve
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=node.ids value=Approve operator=eq phase=selector
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=node.ids value=Ship operator=eq phase=selector
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=node.edge value=bottom words="same bottom line" operator=eq phase=result
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=place mode=arrange mood=do predicate=snap
@r1.t w.request.target request=$r1 family=group mode=existing determiner=definite fill=context
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=group.ids value=Approve value=Ship operator=eq phase=selector
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=node.edge value=bottom operator=eq phase=result
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.barGap value=very words=so operator=degree phase=result key_words=gap
@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.test value=above operator=eq phase=result
@r1.u1 w.request.unread request=$r1 text=even
````

### Case 5 — `diagram/diagrams-03.csv#1435`

Stratum `gold_bad_filler`. Grade `L1c`. Flags `gold_bad_filler`.

Original utterance

````text
I walked the team through Sensor readings by depth this morning; nobody argued with the data, only with how it reads at a glance, so as a first pass make the colour map transparent to green, then we revisit next week and then show both grid lines
````

Published reference

````sop
@f1 w.request.filler text="walked the team through Sensor readings by depth this morning; nobody argued with the data, only with how it reads at a glance, so as a first pass"
@f2 w.request.filler text="then we revisit next week and then"
@r1 w.request.request act=change mood=do words="make the colour map transparent to green" predicate=make
@r1.t w.request.target request=$r1 family=chart mode=existing determiner=definite fill=context
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.palette words="transparent to green" operator=eq phase=result key_words="colour map"
@r2 w.request.request act=change mood=do words="show both grid lines" predicate=show
@r2.t w.request.target request=$r2 family=chart mode=existing determiner=definite fill=context
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=chart.grid value=show operator=eq phase=result key_words="grid lines"
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do predicate=make words="I walked the team through Sensor readings by depth this morning; nobody argued with the data, only with how it reads at a glance, so as a first pass make the colour map transparent to green"
@r1.t w.request.target request=$r1 family=node mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=group.id value="Sensor readings" operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=place attribute=node.position value=near words=by operator=relation phase=result
@r1.c3 w.request.constraint request=$r1 on=place attribute=node.anchor value="depth this morning" operator=relation phase=selector
@r1.c4 w.request.constraint request=$r1 on=attribute attribute=node.role value=data operator=eq phase=result
@r1.c5 w.request.constraint request=$r1 on=attribute attribute=node.colour value=map operator=eq phase=result key_words=colour
@r1.c6 w.request.constraint request=$r1 on=attribute attribute=node.opacity value=green operator=eq phase=result key_words=transparent
@r1.u1 w.request.unread request=$r1 text="walked the team"
@r1.u2 w.request.unread request=$r1 text=argued
@r1.u3 w.request.unread request=$r1 text=only
@r1.u4 w.request.unread request=$r1 text=reads
@r1.u5 w.request.unread request=$r1 text=glance
@r1.u6 w.request.unread request=$r1 text="first pass"
@r2 w.request.request act=make mood=do words="we revisit"
@r2.t w.request.target request=$r2 family=node mode=new determiner=indefinite
@r2.u1 w.request.unread request=$r2 text=revisit
@r3 w.request.request act=change mood=do words=week
@r3.t w.request.target request=$r3 family=chart mode=existing determiner=definite fill=context
@r3.l1 w.request.lookup request=$r3 target=$r3.t key=thing from=page
@r3.c1 w.request.constraint request=$r3 on=attribute attribute=chart.period value=week operator=eq phase=result
@r4 w.request.request act=change mood=do predicate=show words="show both grid lines"
@r4.t w.request.target request=$r4 family=chart mode=existing determiner=quantified fill=all quantifier=both
@r4.c1 w.request.constraint request=$r4 on=attribute attribute=chart.type value=line operator=eq phase=result key_words=grid
````

### Case 6 — `diagram/charts-04.csv#3495`

Stratum `gold_bad_filler`. Grade `L2a`. Flags `gold_left_unread`, `gold_bad_filler`.

Original utterance

````text
do the marker outlines as thick as possible on the order scatter plus can you make the marker interval maxed out?
````

Published reference

````sop
@f1 w.request.filler text=plus
@r1 w.request.request act=change mood=do words="do the marker outlines as thick as possible on the order scatter" predicate=do
@r1.t w.request.target request=$r1 family=chart mode=existing determiner=definite fill=written name="order scatter"
@r1.u1 w.request.unread request=$r1 text="marker outlines as thick as possible" note=chart.marker.edge.width value=max
@r2 w.request.request act=change mood=do words="can you make the marker interval maxed out?" predicate=make
@r2.t w.request.target request=$r2 family=chart mode=existing determiner=definite fill=context
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=chart.markerInterval value=max words="marker interval maxed out" operator=eq phase=result key_words="marker interval"
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=change mood=do predicate=make
@r1.t w.request.target request=$r1 family=chart mode=existing determiner=definite fill=context description="order scatter"
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.effect value=outline operator=eq phase=selector
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.markerSize value=thick operator=degree phase=selector key_words=marker
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.markerType value=plus operator=eq phase=result
@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.markerEdge value="interval maxed out" operator=eq phase=result key_words=marker
@r1.u1 w.request.unread request=$r1 text=possible
````

### Case 7 — `drawing/scenes-11.csv#866`

Stratum `gold_left_unread`. Grade `L1c`. Flags `gold_uncovered_words`, `gold_left_unread`.

Original utterance

````text
instead, a small dog down at the bottom, next slide the boy in the orange shirt all the way to the far left end, then slide the girl in the purple shirt to the far right end, so they are well apart — keep the rest as it is
````

Published reference

````sop
@f1 w.request.filler text=then
@f2 w.request.filler text="so they are well"
@f3 w.request.filler text="keep the rest"
@prev w.request.previous text="move the man in the red coat one spot left"
@r1 w.request.request act=make mood=do words="a small dog down at the bottom"
@r1.t w.request.target request=$r1 family=drawn mode=new determiner=indefinite sort=dog
@r1.c91 w.request.constraint request=$r1 on=size attribute=drawn.size value=small operator=degree phase=result
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=drawn.at value=bottom words="down at the bottom" operator=region phase=result
@r2 w.request.request act=change mood=do words="slide the boy in the orange shirt all the way to the far left end" predicate=slide
@r2.t w.request.target request=$r2 family=drawn mode=existing determiner=definite fill=context sort=boy description="the boy in the orange shirt"
@r2.u91 w.request.unread request=$r2 text="shirt all the way to the far" note=drawn.arrangement
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=drawn.direction value=left words="far left end" operator=eq phase=result
@r2.c2 w.request.constraint request=$r2 on=attribute attribute=drawn.at value=left words="far left end" operator=region phase=result
@r2.c3 w.request.constraint request=$r2 on=attribute attribute=drawn.colour value=orange operator=eq phase=selector
@r3 w.request.request act=change mood=do words="slide the girl in the purple shirt to the far right end, so they are well apart" predicate=slide
@r3.t w.request.target request=$r3 family=drawn mode=existing determiner=definite fill=context sort=girl description="the girl in the purple shirt"
@r3.c1 w.request.constraint request=$r3 on=attribute attribute=drawn.direction value=right words="far right end" operator=eq phase=result
@r3.c2 w.request.constraint request=$r3 on=attribute attribute=drawn.at value=right words="far right end" operator=region phase=result
@r3.c3 w.request.constraint request=$r3 on=attribute attribute=drawn.colour value=purple operator=eq phase=selector
````

Emitted proposal selected for grading

````sop
@prev w.request.previous text="move the man in the red coat one spot left"
@r1 w.request.request act=make mood=do words="instead, a small dog down at the bottom"
@r1.t w.request.target request=$r1 family=drawn mode=new determiner=indefinite sort=dog
@r1.c1 w.request.constraint request=$r1 on=size attribute=drawn.size value=small operator=degree phase=result
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=drawn.at value=bottom operator=region phase=result
@r2 w.request.request act=place mood=do predicate=slide words="slide the boy in the orange shirt all the way to the far left end"
@r2.t w.request.target request=$r2 family=drawn mode=existing determiner=definite fill=all sort=boy quantifier=all
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=drawn.color value=orange operator=eq phase=result
@r2.c2 w.request.constraint request=$r2 on=attribute attribute=drawn.wear value=shirt operator=eq phase=result
@r2.c3 w.request.constraint request=$r2 on=size attribute=drawn.size value=far operator=degree phase=result
@r2.c4 w.request.constraint request=$r2 on=attribute attribute=drawn.direction value=left operator=eq phase=result
@r2.c5 w.request.constraint request=$r2 on=attribute attribute=drawn.align value=end operator=eq phase=result
@r2.u1 w.request.unread request=$r2 text=way
@r3 w.request.request act=place mood=do predicate=slide words="slide the girl in the purple shirt to the far right end"
@r3.t w.request.target request=$r3 family=drawn mode=existing determiner=definite fill=description sort=girl
@r3.c1 w.request.constraint request=$r3 on=attribute attribute=drawn.colour value=purple operator=eq phase=result
@r3.c2 w.request.constraint request=$r3 on=attribute attribute=drawn.wear value=shirt operator=eq phase=result
@r3.c3 w.request.constraint request=$r3 on=size attribute=drawn.size value=far operator=degree phase=result
@r3.c4 w.request.constraint request=$r3 on=attribute attribute=drawn.direction value=right operator=eq phase=result
@r3.c5 w.request.constraint request=$r3 on=attribute attribute=drawn.align value=end operator=eq phase=result
@f1 w.request.filler text=well
@r4 w.request.request act=remove mood=do predicate=keep words="so they are well apart — keep the rest as it is"
@r4.t w.request.target request=$r4 family=drawn mode=existing determiner=definite fill=context
@r4.l1 w.request.lookup request=$r4 target=$r4.t key=thing from=previous
@r4.c1 w.request.constraint request=$r4 on=attribute attribute=drawn.distance words=apart operator=delta phase=result step=more
@r4.u1 w.request.unread request=$r4 text=rest
````

### Case 8 — `diagram/nodes-04.csv#360`

Stratum `gold_left_unread`. Grade `L4`. Flags `gold_uncovered_words`, `gold_left_unread`.

Original utterance

````text
use a diagram to show how DNS resolves a name, for someone who has never seen it
````

Published reference

````sop
@r1 w.request.request act=make mood=do predicate=use
@r1.t w.request.target request=$r1 family=diagram mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=diagram.kind value=diagram words="a diagram" operator=eq phase=result open_value=true
@r1.u1 w.request.unread request=$r1 text="someone who has never seen it" note=diagram.audience value="someone who has never seen it"
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do
@r1.t w.request.target request=$r1 family=diagram mode=new determiner=indefinite family_words=diagram
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=link.to value="show how DNS resolves" operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=diagram.about value=someone operator=eq phase=result
@r1.u1 w.request.unread request=$r1 text=use
@r1.u2 w.request.unread request=$r1 text=name
@r1.u3 w.request.unread request=$r1 text=seen
````

### Case 9 — `diagram/charts-05.csv#898`

Stratum `gold_left_unread`. Grade `L1c`. Flags `gold_left_unread`.

Original utterance

````text
Visualise a paired view of the regional revenue, this year against last year, two bars per region in a bar chart and make the bars blue
````

Published reference

````sop
@r1 w.request.request act=make mood=do words="Visualise a paired view of the regional revenue, this year against last year, two bars per region in a bar chart" predicate=Visualise
@r1.t w.request.target request=$r1 family=chart mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.type value=bar words="bar chart" operator=eq phase=result
@r1.c4 w.request.constraint request=$r1 on=attribute attribute=chart.compare value=side_by_side words="this year against last year, two bars per region" operator=eq phase=result
@r2 w.request.request act=change mood=do words="make the bars blue" predicate=make
@r2.t w.request.target request=$r2 family=chart mode=existing determiner=definite fill=context
@r2.l1 w.request.lookup request=$r2 target=$r2.t key=thing from=page
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=chart.colour value=blue operator=eq phase=result words="the bars blue"
@r1.u2 w.request.unread request=$r1 text="Visualise a paired view" note=chart.comparison
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.dimension value=region words=regional operator=eq phase=result key_words="per region"
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.measure value=revenue operator=eq phase=result
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do predicate=Visualise words="Visualise a paired view of the regional revenue"
@r1.t w.request.target request=$r1 family=chart mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.compare value=side_by_side words="paired view" operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.measure value="regional revenue" operator=eq phase=result
@r2 w.request.request act=change mood=do predicate=make words="this year against last year, two bars per region in a bar chart and make the bars blue"
@r2.t w.request.target request=$r2 family=chart mode=existing determiner=definite fill=description sort=bar sort_words=bars family_words=bars count=2 count_words=two
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=chart.period value=year operator=eq phase=selector
@r2.c2 w.request.constraint request=$r2 on=attribute attribute=chart.dimension value="last year" operator=eq phase=selector
@r2.c3 w.request.constraint request=$r2 on=attribute attribute=chart.dimension value=region operator=eq phase=selector
@r2.c4 w.request.constraint request=$r2 on=attribute attribute=chart.type value=bar operator=eq phase=selector
@r2.c5 w.request.constraint request=$r2 on=attribute attribute=chart.colour value=blue operator=eq phase=result
````

### Case 10 — `document/text-06.csv#156`

Stratum `gold_uncovered_words`. Grade `L1a`. Flags `gold_uncovered_words`.

Original utterance

````text
if "onboarding guide" in the Summary isn't linked yet, add a link to https://wiki.example.com/onboarding
````

Published reference

````sop
@r1 w.request.request act=change mood=do predicate=add
@r1.t w.request.target request=$r1 family=block mode=existing determiner=definite fill=written name=Summary
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=block.id value=Summary operator=eq phase=selector
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=block.mark value=link operator=eq phase=result
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=block.text value="onboarding guide" operator=eq phase=selector
@r1.c4 w.request.constraint request=$r1 on=attribute attribute=block.attrs value="https://wiki.example.com/onboarding" operator=eq phase=result
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=connect mood=do words="\"onboarding guide\" in the Summary isn't linked yet" predicate=linked
@r1.t w.request.target request=$r1 family=section mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=section.content value="onboarding guide" operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=section.id value=Summary operator=eq phase=result
@r1.u1 w.request.unread request=$r1 text=yet
@r2 w.request.request act=make mood=do words="add a link to https://wiki" predicate=add
@r2.t w.request.target request=$r2 family=inline mode=new determiner=indefinite
@r2.c1 w.request.constraint request=$r2 on=attribute attribute=inline.link_target value=https operator=eq phase=result key_words=link
@r2.u1 w.request.unread request=$r2 text=wiki
@r3 w.request.request act=make mood=do words="example.com/onboarding"
@r3.t w.request.target request=$r3 family=section mode=new determiner=indefinite
@r3.u1 w.request.unread request=$r3 text=example
@r3.u2 w.request.unread request=$r3 text=com
@r3.u3 w.request.unread request=$r3 text=onboarding
````

### Case 11 — `diagram/nodes-04.csv#2633`

Stratum `gold_uncovered_words`. Grade `L4`. Flags `gold_uncovered_words`.

Original utterance

````text
not that one, the refund
````

Published reference

````sop
@prev w.request.previous text="the last diagram was about a different subject"
@r1 w.request.request act=make mood=do predicate=not
@r1.t w.request.target request=$r1 family=diagram mode=new determiner=indefinite
````

Emitted proposal selected for grading

````sop
@prev w.request.previous text="the last diagram was about a different subject"
@r1 w.request.request act=change mood=do
@r1.t w.request.target request=$r1 family=node mode=existing determiner=definite fill=context
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=previous
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=node.value value="1" words=one operator=eq phase=result want=no
@r1.u1 w.request.unread request=$r1 text=refund
````

### Case 12 — `diagram/diagrams-01.csv#2996`

Stratum `gold_uncovered_words`. Grade `L4`. Flags `gold_uncovered_words`, `gold_left_unread`.

Original utterance

````text
stick to two colours for the whole diagram
````

Published reference

````sop
@r1 w.request.request act=change mood=do predicate=stick
@r1.t w.request.target request=$r1 family=diagram mode=existing determiner=definite fill=context family_words=diagram
@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page
@r1.u1 w.request.unread request=$r1 text="two colours" note=diagram.colour value="two colours"
````

Emitted proposal selected for grading

````sop
@r1 w.request.request act=make mood=do predicate=stick
@r1.t w.request.target request=$r1 family=chart mode=new determiner=indefinite
@r1.c1 w.request.constraint request=$r1 on=attribute attribute=chart.bins value="2" words=two operator=eq phase=result
@r1.c2 w.request.constraint request=$r1 on=attribute attribute=chart.colour value=colours operator=eq phase=result
@r1.c3 w.request.constraint request=$r1 on=attribute attribute=chart.measure value="whole diagram" operator=eq phase=result
````

## READY-CLI-BATCH — Text-only JSONL interface for the Z3 reader

Implementation `946e8f2`. From `nl-formaliser` run `node bin/formalise.mjs --batch --json --tab auto --verify < inputs.jsonl > z3-results.jsonl`. The separate Prolog command is `node bin/formalise.mjs --batch --json --worlds-only < inputs.jsonl > prolog-results.jsonl` from `pro-formaliser`. Both commands and formats are in the Z3 README.

The Z3 CLI smoke returned six JSON objects for six nonempty input lines in order, with statuses `sat`, `sat`, `unknown`, `invalid-input`, `partial`, `sat`. The two spatial pronouns retain `from=any` and their own argument lookups. No output supplied a previous turn, clock or context wire. The forbidden `previous` input returned an explicit record error, and later records still completed. Circuit results carry the native diagnostics on each proposal and the selected result. The Prolog command independently returned five JSON objects for the five text-only inputs. CLI checks passed 2/2 and the complete serial Z3 suite passed 220/220 on the CLI change in isolation. Please review this scoped tool delivery.

## READY-COMPAT-BATCH — Common library and JSONL protocol

Z3 revision `4ad17ed` exports the async, text-only `createReader`, `propose` and `close` interface from `src/reader.mjs`. Its batch CLI uses that same adapter. Both commands use their real default engine and resources and can run outside the checkouts.

```sh
node /home/salboaie/work/sopworlds/pro-formaliser/bin/formalise.mjs --batch < texts.jsonl > prolog-results.jsonl
node /home/salboaie/work/sopworlds/nl-formaliser/bin/formalise.mjs --batch < texts.jsonl > z3-results.jsonl
```

I ran both commands outside their checkouts with the same seven lines. Each returned seven results in order with the correct engine identifier and common fields. Both rejected the history-bearing and malformed records and reached the final positive. Candidate counts were `[11,34,0,0,0,0,12]` for Prolog and `[7,8,0,0,0,7,7]` for Z3. The mixed negative and positive directive had unresolved evidence in both readers and seven partial Z3 candidates. The Z3 proposals passed their native checks. The returned candidates contained no history wires or previous lookup source.

I also opened one default library reader per engine from outside their checkouts and reused each for four calls before closing. The candidate counts were `[11,34,0,12]` and `[7,8,0,7]`. The targeted Z3 library and CLI suite passes 3/3. The full serial suite passes 221/221 on the isolated staged change, and the legacy single-message spelling command still corrects and verifies `copy the atble`. Please review the committed compatibility surface. The possessive-part work is separate and remains in progress.

## READY Q-NL-029 — Validate globally declared request properties

The current validator rejects valid mixed-family circuits according to the caller's UI partition. I will load all native key declarations, retain each declaration's identity and owner family, and validate properties and values against the circuit's own request targets. The canonical catalog contains two distinct declarations each for `group.name` and `preference.key`. The output wire names these properties without a declaration ID. Please review how those two names should be disambiguated or retired canonically. Until then, retain both declarations and test each complete candidate reading against a compatible declaration without combining their value sets.

The next generation step is one lexical lattice and solver search using the global catalog, with family selected per written request. Check an actual combined drawing and calendar utterance, incompatible owners, unknown keys, closed values, and a literal UI word in the input. Review and data coordination should treat the current historical benchmark as a published measurement, rather than reuse its partition-based evaluator as the current validation contract.

The native validator now loads all request-key shards and checks a constraint against its request target family and a complete candidate declaration. It retains 443 declarations at 429 property names across 23 families on knowledge `3b2deebd`. The two `group.name` meanings and the two `preference.key` shapes remain separate. The solver and verifier use the same existing semantic target/property compatibility rules. The comparator validates the actual circuits without the dataset folder. This changes validation and the solver's family-compatibility lookup. Generation, candidate scoring, the outer legacy evaluation runner, and their metadata remain partitioned.

The native check accepts a mixed `drawn` plus `meeting` circuit for `make the house blue and book Ops review`. It rejects an incompatible property on the meeting, an unknown property, and an invalid `chart.type` value with `open_value=false`. The current generator returned eight structurally valid alternatives on that input, and none emitted both requested families. This is the concrete generation case for the next increment. The focused suite passes 15/15 and the full serial suite 226/226. Please review the native validator and retained declaration provenance. The published 1% result has not been recalculated.

## READY Q-NL-030 — Generate a mixed-family circuit in one shared Z3 search

The common Z3 library and the formalisation CLI now load one global lexical catalog and build a single lattice. Competing semantic families are represented on each request in the same optimization problem. The production reader does not build area catalogs, rank areas, or attach area metadata. Legacy low-level calls and historical evaluation still use the old path. Their removal and numbered SOP reference-column support remain open. The native declaration index retains competing meanings when a wire label is shared.

The current-text batch keeps both clauses of `make the house blue and book Ops review` in the first verified proposal. It emits the existing house with a blue result and a new meeting titled `Ops review`. Written booking arguments bind to the predicate that introduces them rather than becoming IDs of unrelated targets. In `move it next to them`, valid node and drawn-object proposals both preserve the exact target and landmark references. The quoted title `Browser tab` stays intact. Routing and history flags are rejected by the CLI.

An eight-row smoke from published WebMeet `23f19aa` produced native-valid candidates in every row. Both booking rows retained their written titles, days, times and durations. Both nested part rows retained owners and explicit results. The two growth commands are ambiguous between compatible object families in text-only mode. This smoke also exposed that a generic owner frame could read the words `add a` as a name in a heading creation. A generic article boundary corrected the heading and section probes, and the CLI checks the actual heading creation. Please review this behavior as a reusable parser correction. No new benchmark result is claimed.

The direct heading check on `document/text-04.csv` records 2 and 3 now keeps the creation, heading and title. Record 17 exposes a separate group of errors in coordinated creations with one shared verb. The reader merges the heading and paragraph into one target, even though `Introduction` and `Welcome` belong to separate objects. Count these by their shared mechanism in the next audit, rather than treating a correct single heading as proof of coordinated creation.

The full serial suite passes 226/226. The CLI cases cover the common library, the mixed circuit, alternatives and diagnostics without history, rejected routing arguments, and literal text containing the word `tab`.

## STATUS PENTRU REVIEWER — L0–L4 și următoarea familie de erori

Te rog să afișezi acest tabel integral, împreună cu ora și stadiul curent, în outputul tău către owner. Este ultima măsurare completă din WebMeet 1%, cu 1.892 de texte și seed 42. Rezultatul a fost consemnat în `1ec3400` pe 25 noiembrie 2026 la 15:29:35 CET. Reader `a6ed12b`, date `3d13d9b`, cunoștințe `3b2deebd`, evaluare Z3. Sursa tabelului este `L1-Issues-plan.md`.

| Nivel | Cazuri | % din total | Semnificație |
| --- | ---: | ---: | --- |
| L0 | 46 | 2,4% | Formalizare inutilizabilă |
| **L1** | **990** | **52,3%** | Formalizare cu eroare de sens |
| L1a | 143 | 7,6% | Intenție greșită |
| L1b | 96 | 5,1% | Țintă sau mod greșit |
| L1c | 603 | 31,9% | Detaliu, valoare sau rol greșit. 23 cazuri de ortografie și 580 din alte cauze |
| L1d | 148 | 7,8% | Instrucțiune sau detaliu inventat |
| **L2** | **198** | **10,5%** | Sens parțial, cu o componentă esențială lipsă |
| L2a | 30 | 1,6% | Lipsește o cerere |
| L2b | 75 | 4,0% | Ținta ori selecția ei este incompletă |
| L2c | 93 | 4,9% | Altă componentă esențială lipsește |
| L3 | 39 | 2,1% | SOP identic cu referința |
| L4 | 619 | 32,7% | Formalizare alternativă acceptabilă |
| **L3 + L4** | **658** | **34,8%** | **Corecte sau acceptabile** |

Nu am rerulat benchmarkul. Stadiul schimbărilor ulterioare se bazează pe probe țintite și teste. Commitul local `4237b80` a trecut 226/226 și permite un circuit cu mai multe familii semantice în API-ul curent. Acum validez consumul coloanelor SOP numerotate, conform priorității pentru corectarea în masă. Apoi grupez defectele semnalate din rularea pe date după cauză și încep cu mecanismul reutilizabil cu impactul verificabil cel mai mare. Avem deja un caz documentat în care un singur verb de creare introduce două obiecte, dar readerul le unește. Voi căuta aceeași cauză în mai multe texte înainte de a estima impactul.

Te rog să notezi în `resposens.md` care sunt cele mai frecvente familii observate în corectarea WebMeet, cu exemple și număr de cazuri când există, și să faci review pe schimbarea de evaluare după raportul READY. Între timp continui lucrul independent pe mecanismele Z3.

### Propunere de corecție — un singur verb de creare pentru mai multe obiecte

Am verificat opt texte candidate din snapshotul WebMeet publicat `23f19aa` cu CLI-ul real, exclusiv prin text. Patru probe clare pierd o cerere sau un obiect, deși circuitul ales trece validarea. Sunt titlul și paragraful (`document/text-04.csv:17`), rândul de copaci și pasărea (`drawing/placement-01.csv:72`), pagina și titlul (`diagram/charts-03.csv:59`), respectiv pagina și treemapul (`diagram/charts-03.csv:419`). Numerele sunt poziții de înregistrări CSV, antetul fiind 1. Grupul a fost ales țintit, deci aceste 4 cazuri nu estimează frecvența în corpus. Celelalte patru au compoziții, enumerări sau erori de analiză suplimentare.

Propun să folosim construcția declarată `ellipsis.verb` pentru grupuri coordonate cu obiecte noi, fiecare cu propriile dovezi din text. Alegerea trebuie să păstreze rolurile și efectele la obiectul lor. Testele de control vor acoperi texte cu `with`, titluri care conțin `and` și verbe repetate. Scopurile, locurile și referințele pronominale rămân legate de cuvintele efective. Te rog să semnalezi eventuale contraexemple sau defecte mai frecvente din rularea de date.

## READY Q-NL-031 — Rate numbered WebMeet SOP references independently

Please review and publish this bounded change. The CSV consumers use one text per row and retain each populated SOP column with its column name and source record. Both comparators select a complete candidate/reference pair. When a sibling reference is invalid, its errors still reach the report with the original text, file, record and column. Rows with no valid reference carry a reference defect. Diagnostic examples use the matched SOP column. WebMeet generation now uses the same global current-text entry point as the common reader and never supplies expected SOP, history or a clock as input. The historical evaluator still offers filesystem-based sample stratification and report groups, and non-WebMeet legacy sources keep their separate entry point.

`node --test test/verify.test.mjs` passes 12/12. The full serial suite passes 228/228. In a one-row smoke using the real reader and benchmark worker, both comparators selected `sop2` at L3, skipped empty `sop1` and returned the native error for `sop`. These checks establish tool behavior. The 1% distribution above is the last measured aggregate.

## Q-NL-032 — One written creation verb governs multiple coordinated new objects

Please review the implementation for the four published WebMeet probes listed above. On Z3 `788365c`, each had one leading request despite two explicit objects. The current reader uses the declared `ellipsis.verb` construction to propose independent scopes where each coordinated item has its own indefinite determiner and licensed head. Each partial solve binds the chosen creation and head in Z3. The joined circuit cites the original text and the verb appears once. The ordinary candidate is still available in the checked two-candidate probes. The construction leaves quoted titles, explicit later verbs and ambiguous nested complements to their ordinary readings.

I ran the four exact records from WebMeet `23f19aa` with the live text-only reader and canonical knowledge `3b2deebd`, using topK 2. The lead candidate contains both creation requests in 4/4 and passes native validation in 4/4. The heading named Introduction and paragraph containing Welcome retain both effects on the right objects. The bird keeps the written landmark `them` and still leaves `single` unread. The page/heading case still needs the declared `that says` text role and the full placement. The treemap case still interprets `linen` as colour, even though the phrase introduces a topic. These four results establish recovery of request structure and are not a corpus accuracy estimate.

The latter two cases expose a separate family of errors in open arguments. Canonical `acts.text.make.text` already declares `that says` and `that reads`, so the next check is whether Z3 binds the value part to content at a grounded clause boundary. `diagram.about` is declared for diagrams and there is no matching chart topic property in the inspected request catalog. Please review the chart topic contract with canonical knowledge/data owners. A chart title is a separate written property.

### READY Q-NL-032 — tests and review request

`node --test test/cli-batch.test.mjs` passed 4/4. The new library regression checks document effects, a three-item drawing list, a literal pronoun, quoted conjunctions, nested complements and explicit later verbs. The first full serial run hit an intermittent Z3 evaluator error on the existing `make all corners rounded` case. The isolated file passed 31/31 and the subsequent full serial suite passed 229/229. Please review and publish this scoped parser change. The historical L0–L4 score is the one in the preceding status report.

## Q-NL-033 — Bind declared dictation phrases to literal content

Please review the current-text reader's handling of the `acts.text.make.text` content role. The parser uses that frame's explicit dictation cues to bind literal text to a declared content property when a typed creation phrase introduces it. The value can begin with a preposition, and a quoted payload keeps its conjunctions. The clause boundary check preserves a following directive with its own evidence. The `called` control still binds a name.

I ran six exact texts from published WebMeet `23f19aa` with the real Z3 library and canonical knowledge `3b2deebd`. Two now bind the intended literal text and cite `that says`. Record `document/text-04.csv:6` keeps the whole `Please review the draft` as paragraph text. Record `diagram/charts-03.csv:59` attaches `Scope` to the heading's content in the second creation and keeps the recognized top placement. The latter still leaves `flush` and `edge` unread. The remaining four probes still miss the intended content. Two have intervening owner selectors, and two use a box as the typed carrier. Canonical `block.text` and `node.label` are already declared for written content and provide grounded paths for those cases. These were targeted probes without a new aggregate benchmark.

### READY Q-NL-033 — review request

The targeted CLI/library tests pass 5/5 and the full serial suite passes 230/230. Please review and publish this scoped parser change. The detailed L0–L4 table above remains the latest aggregate measurement.

## Q-NL-035 — Proposed shared UI vocabulary and request bindings

Please review these canonical proposals with the data worker. I inspected `sop-knowledge-worlds` at `3b2deebd` and `soplang-words-lib` at `5384940`. The library already provides reusable slot, relation and selection mechanisms. Its README places application vocabulary and reusable facts in the knowledge repo. In the knowledge repo, `w.request.target.family` and `sort` can carry lexical types, and `k.actions` already declares `pick`, `deselect`, `save` and `send`. Former area markers in `w.request.key.tab` or `request.goes_to` supply no evidence about a named UI target. The proposals below describe what a user may refer to, with no application instances or active view assumptions.

| Family | Reuse and proposed binding | Positive phrases and controls |
| --- | --- | --- |
| Controls, views and containment | Register a shared `control` target family and lexical sorts `view`, `panel`, `tab`, `dialog`, `menu`, `button`. Reuse `w.request.target` written names and lookup. Declare `control.container` as a relation to the explicitly named containing control, attached as a selector. Reuse the ordinary name slot for a written identifying label. A separate `control.label` key is needed for a requested change to the visible label. | “Select the Drawing tab”, “Focus the Preview panel”, “Click Export in the File menu”. An unnamed “tab” has no written instance ID. The word “Export” inside a named button does not request a file export. “Draw a box” has no UI target. |
| State and navigation | Use `change` with declared boolean result keys `control.active`, `control.focused`, `control.visible` and `control.enabled` when the verb and UI object identify the state. Add role frames distinguishing navigation to a view, focus, showing or closing a dialog and enabling a control. A bare click requests invocation, with no written result state. Prefer an explicit unsupported span until a reusable `activate` action is agreed for that case. | “Switch to the Layout view” requests active, “Focus the Layers panel” requests focused, “Close the Export dialog” requests visible=no if that reading is licensed, “Disable the Apply button” requests enabled=no. Focus alone supplies no selected state. “Delete the chart” still removes a chart. “Open the report” can refer to loading a document and does not imply a dialog. |
| Selection | Use the existing `pick` act for an explicitly selected target and `deselect` for removing it from selection. `k.actions.role.deselect.thing` already says that the absence of a thing clears selection. Bind “clear the selection” through a lexical frame, since bare “clear” already licenses removal. Use a separate declared `control.selected` boolean for state questions/selectors. Keep checked state distinct when a check box lexically licenses it. | “Select the Preview tab”, “Deselect the red nodes”, “Clear the current selection”, “Is the Auto-refresh button selected?” “Clear the chart” and “Remove the selected nodes” are removal readings when that is what is written. |
| Save and export operands | Reuse `k.actions.role.save.thing/name/place/format` and existing `export` lexical entries. Use `save` for saving or creating an explicit file copy. Preserve `send` only where the text requests transfer or a distinct receiving endpoint. `w.request.intent role=destination` already represents the written destination and permits exact evidence. Propose a minimal new allowed intent role `format`, since it is a request operand, not an intrinsic property of the chart or file. Reuse the existing saving-name role for “as Draft” once its wire binding is declared. Select name or format using lexical format evidence and preserve supported alternatives where ambiguous. | “Save this document”, “Export the chart as PDF to Reports”, “Save this as Draft”, “Send the CSV to Lina”. “Save this document” supplies no format or destination. “Export” as a button label supplies no artifact. “As Draft” does not imply a format. |

**Native shapes.** The first proposal needs a catalog family and words, rather than a new target wire type. For “Select the Drawing tab”, the proposed shape is `@r1 w.request.request act=pick mood=do predicate=Select` and `@r1.t w.request.target request=$r1 family=control mode=existing sort=tab name=Drawing determiner=definite fill=written`. Current native validation rejects exactly the undeclared control family. The state/containment shapes extend that target with ordinary `w.request.constraint` wires, for example `on=attribute attribute=control.focused value=yes operator=eq phase=result`, and `attribute=control.container value=File phase=selector` when written. An event action is needed only if the user requests invocation with no named result and shared state keys cannot express it.

“Deselect everything” already passes native validation with `@r1 w.request.request act=deselect mood=do predicate=Deselect` and no invented target. “Clear the selection” with `act=deselect` is structurally accepted, but the existing generic removal-verb check raises a contradiction warning and leaves selection coverage unresolved. Teach both readers and semantic warning checks the lexical frame. The canonical `acts.deselect` frame currently points to `pick` while its verb part points to `deselect`; verify or normalize that through the existing declared mode-map before using it as a direct action binding.

“Export the chart to Reports” passes native validation as `act=save`, with existing chart target, `lookup key=thing from=any words=chart` and `@r1.i1 w.request.intent request=$r1 role=destination value=Reports words="to Reports"`. Adding `role=format value=PDF words="as PDF"` currently fails only the role enumeration. Until format has a declared wire binding, preserve the exact span as unread. These are validator checks of the proposed wires, not reader-generated success. Please route catalog and frame choices through canonical data integration for both readers.

## READY Q-NL-034 — Preserve dictated text on named-parent blocks and text boxes

Please review and publish the reader change. It uses the shared declared written-text relation to bind `block.text` as an alternative to `section.content`. A textual modifier on a compatible node head licenses `node.label`. An explicit `under` followed by a named reference and a dictation cue keeps the parent separate from the literal. The selected dictation excludes unanchored candidates for a second value of the same property on the same request.

Three exact WebMeet probes from `23f19aa` now keep their intended written values and pass native validation. Record `document/text-03.csv:1566` keeps parent Intro, text Main and level 3 on the paragraph block. The instruction about using the parent's name remains unresolved. Record `diagram/nodes-01.csv:629` keeps the whole label “served by the morning crew”. Record `diagram/charts-03.csv:69` keeps label Scopa and the later placement request with the written reference `it`. The word `heading` still lacks a full semantic role in this reading. The other previously reported construction with `to Intro with the text` remains open. The full serial suite passes 231/231. These are targeted checks and the last complete L0–L4 table remains the one above.

### Q-NL-035 follow-up — chart topic, exact structural checks

I tested the reviewer's suggested reuse of `diagram.about` with the native verifier. An existing request shape with `family=chart` and `attribute=diagram.about` passes for “Create a chart about shipping delays” and “Make a treemap about plant groups”. The same property fails for a `family=section` target. Current family compatibility already permits chart/diagram properties in the same request. This means a new request key is premature.

The verifier also accepts a hand-authored `diagram.about` value for “Create a chart titled Shipping delays” if the written cue is cited. That reading is semantically wrong and demonstrates the need for lexical role separation in the reader. For the chart subject follow-up, favor a declared topic only when a grounded chart/diagram and an explicit topic phrase are present. Use `chart.title` on title cues and keep quantitative measure and grouping operands separate. Verify whether the canonical diagram topic can be owned by the same chart reading across both readers before adding a chart subject slot. These probes are validator checks, not successful reader outputs or evidence of execution.

## READY Q-NL-036 — Consume canonical selection-wide and scoped deselection

Please review and publish the reader change. The shared `pick.none → deselect` mode map and the two declared selection-wide frames supply the complete predicate. “Clear the current selection” and “Deselect everything” emit one `deselect` request with neither object target nor lookup. A written pronoun keeps its exact lookup evidence. An incomplete fallback owner span cannot turn a directive and its determiner into an invented name. Thus “Deselect the red nodes” applies red as a selector on nodes, and “Delete the selected nodes” keeps its removal intent. The latter still leaves `selected` unread with current property bindings.

The actual text-only reader on WebMeet `23f19aa` emits one native-valid targetless deselection for `diagram/nodes-12.csv:1212`. It also recovers the deselection in record 1205, but incorrectly creates a separate pick request from the declarative past clause “I selected the wrong thing earlier”. That clause requires a separate correction to distinguish reported events from current directives. Controls cover an independent following command and a quoted selection phrase used as a text-box label. Full serial suite passes 232/232. The historical L0–L4 table remains the last aggregate measurement.

## Q-NL-037 — Separate reported past events from present directives

The Z3 reader now detects explicit subject plus a declared past or perfect action before an independent directive. It uses the canonical subject-pronoun and irregular verb inflection tables and the existing finite request boundaries. The exact report goes into `unresolved` as `reported-event`. A declarative past question receives a distinct diagnostic because the current-text circuit cannot answer that event question. The reported span cannot contribute a target, lookup, time adjustment or action to the later imperative. The literal reference of the current directive remains current-text evidence.

On the real reader and published WebMeet `23f19aa`, `diagram/nodes-12.csv:1201,1205,1227` all discard the spurious pick/time request while retaining the exact report and one current request. In 1205 that request is correctly `deselect`. In 1201 and 1227 the existing reader still misreads “clear away the selection” as removal. The inspected selection-clear frame lists `clear` and other single-word triggers, but does not list the multiword form `clear away`. Please review a reusable, scoped lexical variant in the shared frame. It should apply to selection objects only; “clear away the boxes” remains a removal reading. The native verifier still flags report words as uncovered in the wires because the evidence is carried in the diagnostics.

The reviewer's exact reproduction, “I selected the wrong node earlier. Clear the selection”, now emits only targetless deselection and preserves the exact report in diagnostics. Real CLI controls also preserve standalone “Select the red nodes” as `pick`, and keep “I selected the wrong node earlier” inside a quoted text-box label without classifying it as a report. The focused library regression additionally covers irregular past, contracted and expanded perfect, a past question and the untouched unresolved `it` in the following command.

### READY Q-NL-037 — review request

The first full gate exposed that lightweight lattice fixtures omit the canonical pronoun and tense tables. The report detection now checks that those declarations are available. The isolated lattice file passes 7/7 and the subsequent full serial suite passes 233/233. Please review and publish this scoped change. The detailed L0–L4 table above remains the last aggregate measurement.

## Q-NL-038 — Preserve explicit graphic subjects using the existing topic key

The reader now consumes the declared `acts.make.diagram` topic cue for a chart or diagram noun with an explicit creation predicate. Its existing `diagram.about` key binds the full written complement to the selected chart/diagram target. This separates the topic from coincidentally compatible colour, material or scene terms. Naming continuations retain their own role. No chart-subject schema addition was required for these checked requests.

On the real Z3 reader and published WebMeet `23f19aa` (canonical knowledge `3b2deebd`), seven of eight targeted cases in `diagram/charts-03.csv` kept their full explicit subject and passed native validation. Record 419 now places `diagram.about="the linen room"` on the second, treemap request, replacing the spurious linen colour and room scene. Record 425 separates an explicitly repeated creation verb. Records 3728, 3786, 3807, 3848, and 3916 preserve lab onboarding, the faculty, the hiring rounds, the pond system, and how pizza ordering works, respectively. Record 415 still drops the treemap and subject in a verbless placement clause. This is a targeted property result, not a comparison of aggregate accuracy.

Controls distinguish a title, a naming continuation, a by-month data operand and a conjunction in a literal topic. The by-month probe still leaves “sales” unread. The case “about average delivery time by depot” can need separate topic and grouping recognition; this change does not establish that reading.

### READY Q-NL-038 — review request

The focused subject regression passes and the full serial suite passes 234/234. Please review and publish this scoped reader change. The detailed L0–L4 table above remains the latest aggregate measurement.

## Q-NL-039 — Consume declared options questions as native list requests

The latest independent reviewer failure drove this change. The lexically explicit `acts.more.ask.options.what` and `acts.more.ask.options.show` frames already declare `act=ask` and `needs=list`. Z3 now consumes the ordered literal frames as `act=ask mood=ask question=list`, retaining the exact question predicate and leaving out a nonexistent object/lookup. This uses the native list enum and the declared `i/u/you` grammar. Existing targetless handling also supports these predicates before or after an independent request. No application capabilities or active UI state are inferred.

The actual reader emits native-valid list questions without warnings for both reviewer examples and for “Show me what I can draw”, “What can you add to my picture?”, and “Which can I choose?”. A following or preceding house-colour command remains separate. “Can you draw a cat?” remains an indirect creation request and the quoted title “What can I draw” retains its literal name. The two defect texts appear in the review/dataset work but were not in the inspected pinned WebMeet `23f19aa` snapshot; the exact smoke inputs come from the review. This is focused reader evidence, not a new aggregate.

**File request still open.** I checked “can i have the drawing as a file” by hand with the native verifier. Both `act=ask mood=check` and `act=save mood=do` pass structurally when they cite the written modal predicate, preserve the declared drawing target with lookup evidence, and retain `as a file` as unread. These are prospective partial circuits, not reader outputs. The available role frames directly license save/download/export and file formats, but the inspected grammar lacks a binding from first-person modal possession to grounded file delivery. Please review that lexical-role binding and the file-form request operand together. The permission and polite-delivery readings can coexist. Neither licenses a file format, filename, destination, successful delivery, or an object named “can i”.

The first top-K smoke found identical circuits from different internal family assignments even though the question has no target. The final change fixes that hidden slot for the exact options frame and keeps the list question selected while compatible following commands are considered. The focused regression checks exactly one circuit per standalone options question at topK 2, as well as options questions before and after a separate edit.

### READY Q-NL-039 — review request

The focused test passes and the full serial suite passes 235/235 on the final source. Please review and publish the bounded options-question change. The historical L0–L4 result remains the latest aggregate.

## Q-NL-040 — Keep the explicitly saved artifact separate from output operands

The Z3 reader now consumes the existing save/download/export frames to retain the artifact before their output marker, and attaches an explicitly grounded destination with the native request-owned `w.request.intent` wire. “Export the chart as PDF to Reports” keeps chart as the existing target, Reports as the destination, and exact “as PDF” as unread while the format role is unavailable. “Save the chart as Draft” likewise keeps its ambiguous name/form as an unread operand. A bare token after `to` that could be a format symbol is retained as an unresolved destination-or-format operand; “to PDF” does not create a destination. Native intent evidence is checked against the source text. The shared reader marks candidates with a leading unread operand as partial.

The real reader on five exact published WebMeet exports (snapshot `23f19aa`, `diagram/nodes-02.csv:3174,3176,3177,3179,3180`) retained the intended save/download action, exact file-form evidence and the stated or pronominal artifact in all five. Each passed native validation as a partial result. The report/recipient adjuncts in 3177/3180 stay unread with the file-form wording. The local spatial control `diagram/diagrams-01.csv:30`, “send the middle box to the last position”, still travels through the ordinary parser without an output intent. Its existing semantic classification remains a separate issue. The first-person “can I have the drawing as a file?” remains open pending the modal role binding; these changes apply to explicit save/download/export wording.

**Evaluator follow-up.** I reproduced a false L4 in `eval/compare.mjs` using “Export the chart from Archive to Reports”, with the same chart target and source held constant. Against a native reference with destination Reports, both the prediction with destination omitted and the prediction with Archive as destination reported `semanticExact=true` and L4. The summarizer currently ignores request-owned intents. Please review a shared evaluation fix comparing intent role, value, polarity and request ownership in both comparators before treating their grades as evidence for this family.

### READY Q-NL-040 — review request

The focused output-role regression passes and the full serial suite passes 236/236 on the delivered source. Please review and publish this scoped reader change. The published L0–L4 table remains the last aggregate measurement.

## Q-NL-041 — Grade request-owned purposes and destinations

The mechanical and Z3 comparators now retain `w.request.intent` by its actual request owner. Both compare role, written value and polarity as a multiset. Local wire IDs and wire order do not affect the result. The written value match preserves case and ignores only outer whitespace; no alias for a destination is inferred. Z3 matches these operands on its selected request alignment and prevents their score from overriding written target identity.

For the reported “Export Revenue from Archive to Reports for review” reproduction, both comparators grade a missing destination L2b and Archive substituted as destination L1b. The checked controls also grade missing purpose L2c, reversed polarity or substituted role L1c, and an unsupported extra intent L1d. Swapping destinations between two different named charts remains L1b. Reordering the same requests in Z3 remains L4, and a valid later reference column remains eligible for L3. The focused verifier/evaluator suite passes 13/13.

The newly reviewed reader limitation “Export the chart from Archive to Reports” is separate. It currently attaches Archive as a target identity. The native request intent enum declares purpose and destination only. A distinct source operand should stay as exact unread evidence until its canonical binding is available, while a real written artifact name remains a name. The historical aggregate table was not rerun.

### READY Q-NL-041 — review request

The final focused suite passes 13/13 and the full serial suite passes 237/237. Please review and publish the bounded scoring correction. The detailed historical table above remains the latest aggregate measurement.

## Q-NL-042 — Keep the source operand separate from artifact identity

The output-role matcher now uses the declared `from` source cue to bound the artifact before it. The existing request intent schema has no source operand, so the literal source becomes `w.request.unread note=save.source`. The destination remains the existing native `w.request.intent` on the output request. Adjacent unread spans with different roles remain separate, so the reader preserves a later format operand and its own note.

The reviewer's exact “Export the chart from Archive to Reports” now retains chart as the typed artifact, “from Archive” as a separate unresolved operand and Reports as the destination in all proposals of the checked call. Controls preserve the written name in “the chart named Archive” and in the quoted “From Archive”, preserve the entire quoted source “Drafts and Notes”, and keep “from the shared folder” and “as a file” as distinct operands on a download. These are real reader/validator checks of the role boundaries. No matching explicit export-source rows were found in the pinned `23f19aa` scan. This scope leaves the separately reviewed first-person modal file request open.

The data worker's CLEAN-BULK-5 hand-adjudication records the modal file request as a polite save reading with the drawing retained and “as a file” preserved unread. That records the intended reading for a focused real-reader check once the modal artifact-role binding is agreed.

### READY Q-NL-042 — review request

The focused source-role regression passes and the full serial suite passes 238/238. Please review and publish this scoped change. The detailed historical L0–L4 table remains the last aggregate measurement.

## Q-NL-043 — Preserve first-person modal file requests without inferring a format

The current-text reader composes the existing modal and first-person wish leads (`shape.can`, `shape.wishto`), the declared possession lead, the native document/file noun and the existing download format marker. A first-person “have” request enters this handling only when the text explicitly requests the identified artifact in file form. There is no output application inventory or guessed file kind. The leading reading is `save`, consistent with CLEAN-BULK-5's semantic adjudication. The supported `ask mood=check` alternative preserves the other interpretation without inventing a capability question enum or an unrelated question type.

Actual text-only Z3 checks on the current unpublished WebMeet row `drawing/scenes-22.csv:979` preserve the exact predicate `can i have`, the existing drawing target, and `as a file` as unread in both native-valid partial circuits. Other checked inputs vary can/could/may, subject, diagram/chart, image-file wording and an explicit destination. “Can we have it as a file?” keeps lookup from=any with literal it. The indirect cat-creation and quoted title controls still work. A modal possession request without an explicit file form is outside this binding; the separate “Can I have a blue circle?” target-name defect remains visible. These checks do not establish any specific export format or actual delivery.

A lexical scan of published `23f19aa` found 25 texts starting with a first-person modal possession lead. Three have an immediate indefinite article and 22 have other operand shapes. This counts surface forms, not formalization failures. Many of the latter ask for real property changes, such as flipped axes (`diagram/charts-06.csv:788`) or grey bars (`:1088`). They justify a separate role-binding check and are controls against treating every modal “have” as file delivery.

### READY Q-NL-043 — review request

The focused modal-file regression passes and the full serial suite passes 239/239. Please review and publish this scoped reader change. The last aggregate L0–L4 measurement remains the historical table above.

## Q-NL-044 — Compose modal subjects and bind creation versus property changes

The first-person modal grammar now combines allowed modal words from the published question/wish frames with independently declared first-person subject pronouns. This covers the reviewer's “Could we have it as a file to Reports?” without inserting a private phrase. The actual reader keeps literal `it`, destination Reports and exact `as a file` unread. The file form does not become an object or guessed format.

For the related modal-want construction, a typed indefinite object after the lead licenses creation, while a grounded existing object or written pronoun with a typed result licenses change. The selected Z3 target must be grounded after the modal predicate. “Can I have a blue circle?” and “Could I have a heading named Scope?” now emit creations with the stated colour/name. “Could I have the chart red?” binds the existing chart and red effect without the old invented target name. Existing file readings retain their own binding.

Eight exact WebMeet probes from published `23f19aa`, `diagram/charts-06.csv:285,330,422,658,788,945,1088,1134`, all pass native validation. Five use the new modal binding. The two sort directions at 285/330, grey bars at 1088 and narrower bars at 1134 retain their grounded effects and the full modal predicate. Record 788 now binds x-axis inversion to the chart and loses the old page-style effect; “axis” and “flipped” still appear as unread. Records 422/658/945 remain outside this role binding and still need explicit sorting criterion, axis-assignment, and gridline-result semantics respectively. The targeted run is not an aggregate accuracy measurement.

### READY Q-NL-044 — review request

The two focused modal regressions pass and the final full serial suite passes 240/240. Please review and publish this bounded modal composition and role-binding change. The historical L0–L4 table remains the last aggregate measurement.

## READY Q-NL-045 — Bind written chart fields and axis titles to their respective roles

The reader now uses declared chart-axis terms and distinct canonical field/title keys. The solver binds the written field or title as a result of the chart edit, retains the written owner where supplied, and separates a preceding axis edit from an independent following predicate. Two axis assignments can share one predicate. The focused controls include ungrounded owner pronouns, legend placement, and scale wording.

Seven actual Z3 probes from published WebMeet `23f19aa` validate and emit the intended **axis operands** in their leading proposal. In `diagram/charts-06.csv:603,605,647,658,673`, the reader binds Order date, Channel, Headcount, Orders and Revenue to their respective X/Y data fields and retains the written chart owner. In `:687` it binds Sales as the Y-axis title of Monthly sales. In `diagram/diagrams-03.csv:266` it binds profit and sales to the two data fields. The second operation in `:673` still invents `page.style=chart` for “show the values”. The gridline, scale and bar-colour adjuncts in `:266` still contain wrong bindings, including a spurious meeting. Native validation and these seven targeted checks do not grade the whole compounds.

Focused regression 1/1 and full serial suite 241/241. Please independently review and publish the scoped change. For the modal review follow-up, please point me to any published family-neutral target/reference convention you know of. I will inventory the native representation before proposing a shared contract, and use the existing third-person and returned act/mood counterexamples to check the reader.

### Status for reviewer output to the owner

Please include the full table below in your next output to the owner, with the date and snapshot, the two outstanding chart defects, and the separately validated change above. This is the last completed WebMeet 1% aggregate, recorded **2026-11-25 15:29:35 CET** in `1ec3400`, with Z3 reader `a6ed12b`, data `3d13d9b`, knowledge `3b2deebd`, seed 42 and 1,892 rows. No new aggregate was run for Q045.

| Level | Rows | Share | Meaning |
| --- | ---: | ---: | --- |
| L0 | 46 | 2.4% | Unusable formalization |
| **L1** | **990** | **52.3%** | Wrong meaning |
| L1a | 143 | 7.6% | Wrong intent |
| L1b | 96 | 5.1% | Wrong target |
| L1c | 603 | 31.9% | Wrong role, value, or detail. 23 spelling and 580 other |
| L1d | 148 | 7.8% | Invented request or detail |
| **L2** | **198** | **10.5%** | Partial meaning |
| L2a | 30 | 1.6% | Missing request |
| L2b | 75 | 4.0% | Incomplete target, reference, or endpoint |
| L2c | 93 | 4.9% | Other missing semantic detail |
| L3 | 39 | 2.1% | Exact reference match |
| L4 | 619 | 32.7% | Acceptable alternative |
| **L3 + L4** | **658** | **34.8%** | **Correct or acceptable** |

Over 90% on this sample requires at least 1,703 accepted rows.

## Q-NL-046 — Preserve a bare file or copy artifact without assigning it a type

The current-text reader now emits the reviewed native form, `refers=thing` plus a request-owned `w.request.lookup key=thing from=any` with the literal reference. This covers a complete bare artifact on a declared save/export/download or copy command and the existing modal file construction. It does not change property-owner or landmark lookup bindings. For bare references the unused solver family slot is fixed internally; no typed target is emitted. Named and typed modal artifacts retain their target wire.

At the default proposal budget, the reviewer's `Could we have it as a file to Reports?` returns exactly save/do and ask/check, both retaining literal it, Reports and exact form evidence. `Could she have it as a file?` and `Can he have that one as a file?` return ask/check only, with the subject preserved in the predicate and the artifact in its own lookup. `May they have the diagram as an image file?` retains the written diagram on the permission question. Modal controls with an explicitly named chart and quoted “it” preserve the chart name. A separate pre-existing ambiguity remains in direct `Save the chart called "it" to Reports`: it retains the chart and destination but reads the “called” phrase as an unresolved save name/format instead of the artifact's name.

Nine exact WebMeet `23f19aa` probes pass native validation and retain the intended bare artifact without any family assertion. All four copy rows (`diagram/charts-07.csv:235,240,247`, `diagram/diagrams-07.csv:735`) retain their exact reference and copy act. Five save/export/download rows (`diagram/nodes-02.csv:3174,3177,3180,3187,3188`) retain the output act and exact partial format evidence. These targeted checks carry no aggregate score.

**Grading defect exposed by native reuse.** For the reviewer's own reference circuit for “Save it to Reports”, leaving the destination invariant, both graders currently return L4 when the request-owned lookup is deleted, moved from any to previous, or loses its literal words. The Z3 evaluator passes these through its mechanical L4 shortcut. The mechanical comparison reports `lookupMatch=false` for the first mutation but still reports `semanticExact=true`. The other two get `lookupMatch=true`. This needs explicit comparison of an owned reference's source, written words and attachment before either grader can count these cases as accepted. It is separate from native validation and from the reader increment.

**Next reader group.** The published catalog already has `chart.show_values`, `chart.grid` and `chart.gridStyle`. A lexical inventory in the pinned diagram CSVs found 674 rows with explicit show/hide plus a candidate grid or value-label cue, and 464 with grid and solid/dashed/dotted wording. These are candidate rows, with possible overlap and ambiguity, rather than error counts. They include independent following clauses such as `diagram/charts-01.csv:3093,3217,3234,3290` and varied style commands at `diagram/charts-02.csv:577–580`. The grounded property bindings are the next reader work.

### READY Q-NL-046 — review request

Focused reader groups 4/4 and final full serial suite 242/242. Please independently review and publish the scoped reader change. In your output to the owner, keep these targeted results separate from the detailed historical L0–L4 table under Q045 and include the false-L4 lookup reproduction as an open measurement defect.

## Q-NL-047 — Keep chart value labels, grid visibility and grid styling in their own roles

The reader uses the published `chart.show_values`, `chart.grid` and `chart.gridStyle` keys and their declared cues and values. The scoped chart edit binds the written owner or retains the literal lookup, emits the display operation in result phase, and leaves a preceding command independent. A style adjective or explicit result clause does not imply changing grid visibility. Fragmentary requests such as “grid lines dashed” keep a change request with its written key and value, with no manufactured predicate. The same scoped ownership applies to the earlier axis edits. An explicit spreadsheet or a drawing arrangement is outside this matcher.

Thirteen exact WebMeet probes from `23f19aa` native-validate. Eleven leading proposals bind the intended display operand. `diagram/charts-01.csv:3093,3217,3234,3290` all emit `chart.show_values=show` on the second request with literal it. The first chart-creation clauses in this cohort still have target or measure defects. `diagram/charts-06.csv:673` now separates `chart.yField=Revenue` and `chart.show_values=show` and loses the previously invented `page.style=chart`. `diagram/charts-02.csv:577–581,583` all emit `chart.gridStyle=dashed`, including fragment, wish and “should be” syntax. `:582` still misses “go for dashed grid lines” and fabricates a drawn line; `diagram/charts-06.csv:945` still misses dash-dot grid style. Native validity does not establish full-compound correctness.

Please review the canonical gap exposed by `:945`. `w.diagram.group.line_style` already has `dash_dot`, while `w.diagram.group.grid_style` and `chart.gridStyle` currently allow solid/dashed/dotted only. If the canonical grid contract is meant to support that written stroke pattern, reuse `dash_dot` and its lexical spelling on the grid style slot and key. The reader should preserve the unresolved pattern until supplied by the catalog and should never map it to another style or the series line.

### READY Q-NL-047 — review request

Focused chart groups 2/2 and final full serial suite 243/243. Please independently review and publish this scope. Include the targeted result, the two open cases and the unchanged historical L0–L4 measurement under Q045 in your owner output. The independently confirmed false-L4 reference issue is a separate evaluator correction.

## Q-NL-048 — Grade literal reference evidence and attachment in both comparators

The mechanical comparator now requires request-owned lookup agreement for exact, alias, redundant-identifier and cleaner-than-reference acceptance. It compares the native key, explicit or default source, written words and `refers` role, plus the attachment to the request, its target or its specific constraint. It preserves multiplicity, including several lookup wires attached to one operand versus lookups attached to equivalent separate operands. Local target/constraint IDs are normalized through the owning request and canonical constraint signatures. Z3 reuses the same comparison on the selected request alignment and resolves same-message answer dependencies through the aligned requests.

The exact `Save it to Reports` family now gives L2b for a deleted lookup and L1b for substituted source, deleted literal words or moving a lookup to the other request. An extra lookup is L1d. Moving an anchored lookup to a different constraint, the target or the request gives L1b. Swapping the antecedent from the chart question to the diagram question also gives L1b. A wire-order/ID rename and the omitted native `from=any` default remain L4. Z3 also preserves L4 for a reordered equivalent two-request circuit and a reordered answer-dependency circuit. These are actual evaluator regressions. They measure no change in the reader or aggregate accuracy.

Direct calls to both proposal comparators also selected the correct later `sop1` alternative as L3 while reporting the native-invalid `sop2` sibling. The exact original single-request reproduction now yields L3 for equality, L2b for deletion and L1b for the source and wording mutations in both graders.

### READY Q-NL-048 — review request

Evaluator/verifier suite 14/14 and final full serial suite 244/244. Please independently review and publish the scoped comparator correction. In the owner output, identify this as a correction to measurement, separate from the reader and from the last measured L0–L4 table under Q045.

## Q-NL-049 — Keep stroke literals on the written chart property and preserve dependent evidence

The scope now distinguishes chart grid and series-line style, including spaced/hyphenated forms of declared stroke vocabulary and spaced property cues such as “grid line style”. As confirmed in the coordinator's c39 review, a written eligible grid style outside the current grid enum remains the exact literal with `open_value=true`. Series-line dash-dot uses the existing closed `chart.lineStyle=dash_dot`. A scoped grid edit followed by a dependent `, so ...` clause preserves that clause as exact unread evidence. A following independent directive retains its own request. The same value span cannot create a second verb-free request when a modal or wish lead already licenses the edit.

The actual reader native-validates all 12 selected published `23f19aa` inputs. Seven leading proposals bind the intended grid stroke in scope: `diagram/charts-02.csv:3270–3272,3274,3276,3278` and `diagram/charts-06.csv:945`. The first six lead with a native-valid literal grid style and no unresolved report. At `:945`, `chart.gridStyle=dash-dot open_value=true` is a result on the sales chart. The separate reason remains unread, so the utterance is partial. It no longer asserts chart series line style, grid visibility or a prohibition on tables. Controls preserve ordinary dashed grids, visibility and canonical series-line dash-dot. These checks cover the named operands, with no aggregate grade.

**Choice lead proposal.** The other five diagnostic rows remain open: `diagram/charts-02.csv:582,604,3275` use “go for”, `:3273` uses “want to be” after the owner, and `:3277` uses bare “do”. A lexical inventory found 467 starts with “go for” in published `23f19aa`, including font size (`:473`), grid pattern (`:582,604`) and axis side (`:782,805,827`); this is a surface count. Please review declaring “go for” in the shared choice construction alongside the existing pick/request roles. The controlled-property reading should require a licensed option or property result. Preserve “go for a walk” or an explicit motion destination as a different construction, and preserve quoted literal text. This proposal can cover more than grid style and is independent of the approved grid-enum addition.

### READY Q-NL-049 — review request

Focused chart groups 3/3 and final full serial suite 245/245. Please independently review and publish the scoped reader change. For the owner report, keep the native open-literal result and the still-unread reason explicit. The L0–L4 table under Q045 is still the last aggregate measurement.

## Q-NL-050 — Separate chart axis positions, scale and chart identity

The scoped chart editor now binds the category-axis side to `chart.xAxis`, the value-axis side to `chart.axisSide` and the value-axis linear/logarithmic scale to `chart.axisScale`. The legal values and the axis/property cues come from the declared chart keys. “Switch the y axis to log” previously supplied an invented chart named `y` and an open axis-side value. It now supplies a native log scale with an unresolved chart lookup. “Put the x axis on the top” edits the existing chart instead of creating one. A separately written chart name or pronoun remains the owner. A keyword and result licensed by the same scoped edit can bind across a long owner description. The generic keyword-distance limit still applies elsewhere.

All 24 selected `diagram/charts-02.csv` probes from `23f19aa` native-validate. Nineteen preserve the intended axis effect and a faithful owner, including `:713–717,720,725,726,775–777,796–798,800,812,820,821,823`. Row 720 keeps `go` unread. Rows 725, 726 and 812 keep the following grid or axis command independent. Five probes remain open: `:718,719,721` use alternate selection/wish wording, `:728` gets the scale but invents chart name “do the y”, and `:819` has the spelling error `rihgt`. The probe counts qualify only the intended operands.

**Scope and catalog follow-up.** A lexical inventory over the pinned diagram CSVs found 724 rows with a direct axis-side phrase, 93 with a value-axis scale phrase, 216 with “zero-based y/value axis”, and 23 with a separate X-axis scale phrase. These are candidate counts with possible overlap. Zero-based value-axis edits can reuse existing `chart.yMin=0`. The X-axis scale has a distinct representation gap: `:4003–4004` explicitly ask for X linear and Y logarithmic together, while the existing `chart.axisScale` means the value-axis scale only. The actual current “Set the x axis to logarithmic” fallback assigns an open value to `chart.xAxis`, which denotes side, so it is semantically wrong. Please review whether a separate X-axis scale is part of the shared chart contract. Preserve its literal evidence until representable, without treating it as side or as the Y-axis scale. The pending “go for” lexical proposal is independent and unpublished.

### READY Q-NL-050 — review request

Focused chart groups 4/4 and final full serial suite 246/246. Please independently review and publish the scoped axis edit and the long-owner binding. Report these as targeted results, with the last aggregate L0–L4 table still under Q045.

## Q-NL-051 — Bind numeric value-axis bounds and zero-based chart creation

The reader now uses `chart.yMin` and `chart.yMax` for the documented start/cap constructions and explicit minimum/maximum cues. A written “from X to Y” on the value axis retains both bounds on one chart request. It preserves numeric words, signed decimals and an explicit chart name. “Zero-based” on a Y/value axis binds a lower limit of zero, with exact written evidence even when the chart data mentions a year containing the digit zero. A scoped “with a zero-based y axis” modifier of an explicitly created chart constrains that new chart. The candidate cannot satisfy a separate meeting, chart edit, or independent following command.

All 22 targeted published `23f19aa` rows native-validate. Eleven leading proposals retain the intended numeric effect and chart ownership. Eight creation cases are `diagram/charts-01.csv:2994,3091,3092,3093,3290,3763,3766,3805`. The others are `diagram/charts-02.csv:177` (cap 200), `:1887` (range 0 to 10) and `:3317` (start at five). Meanings beyond the numeric operands still differ in some compounds. The remaining eleven probes expose broader creation phrasing and grouping, split start/cap commands, explicit negative alternatives and typos; the mixed existing-chart edit at `diagram/diagrams-03.csv:266` still misses the later zero-based adjunct. Standalone controls keep negative decimal evidence, a later independent cat creation and the distinction from meeting time, X-axis wording and a quoted title.

The Q050 reviewer follow-up is also covered by the evidence binding in this scope. The actual “Set the axis scale on Annual print and digital sales to logarithmic” result retains the full chart name, emits `chart.axisScale=log words=logarithmic`, and has zero uncovered words or warnings. Explicit value evidence survives normalization even when a substring of the canonical value already occurs in the utterance. Separate X-axis scale remains open.

### READY Q-NL-051 — review request

Focused chart groups 5/5, final full serial suite 247/247 and final selected WebMeet rerun 22/22 native-valid, 11/22 with the intended axis operand and chart ownership. Please independently review and publish the numeric value-axis binding and normalized lexical evidence. Keep the last aggregate L0–L4 table under Q045 separate from these checks.

## Q-NL-052 — Preserve an explicit X-scale request independently of X side and Y scale

The installed shared catalog still has no separate X-axis scale slot. On a grounded X/category-axis scale request, the reader now keeps the written scale operand as request-owned unread evidence with note “x-axis scale”. It preserves the named chart or its literal lookup. When a name separates the cue and value, the two written spans stay associated with the same request without duplicating the owner. A coordinated “set X linear and Y logarithmic” keeps the X operand unresolved and emits the native Y scale `chart.axisScale=log words=logarithmic`. The former incorrect open `chart.xAxis=logarithmic` position result is gone on this scoped shape. Quoted labels and real X-axis positions retain their meanings.

The previous modal reading could expose a second scoped predicate at bare “have”. Extending the construction made that overlap observable as UNSAT on the earlier dependent-clause example. The parser now retains the longest written lead for the same property and value spans. Repeated “keep” in a shared edit can bind both written scales, while an independent following marker-size or drawing request keeps its own scope. No closed X-scale result or execution is claimed.

All 23 published `23f19aa` diagram rows from the direct X-scale lexical cohort native-validate. Twelve leading proposals retain the exact requested X-scale wording as an unresolved operand; five of those also emit the intended Y scale (`diagram/charts-02.csv:4003,4006,4009` and `diagram/charts-03.csv:2846,2855`). The other rows expose unresolved command boundaries around independent wish leads, preambles, trailing reasons, or courtesy clauses. Several still select a generic axis label. The two longer compounds at `diagram/charts-02.csv:4003–4004` now retain the written X operand; `:4004` still misclassifies Y because of its following qualifier. These counts establish operand preservation only, with the canonical X representation still open.

### READY Q-NL-052 — review request

Focused chart groups 6/6 and final full serial suite 248/248. Please independently review and publish the preserved X-scale evidence and coordinated Y-scale result. Keep the partial status and remaining grouping failures visible beside the historical L0–L4 table under Q045.

## Q-NL-053 — Bind chart legend visibility and position to the written owner

The scoped parser uses the published `chart.legend` request key for show/hide and written sides. “Add a legend” and “remove the legend” set visibility on the chart named in the clause. “Drop the legend on the right” uses the declared placement reading and retains right; it does not remove the chart or its legend. “Left side” keeps its exact wording and an explicit chart name or pronoun retains its own role. The emitted request key admits the written position; this makes no claim about chart drawing or runtime support.

Chart creation accepts an attached “with”, “without”, or comma legend clause when the preceding creation and chart noun license it. The legend result can coexist with a zero-based Y axis on the same new chart, and a following independent operation stays separate. Coordinated visibility “hide the legend on the Expenses by department chart and the values as well” now binds both `chart.legend=hide` and `chart.show_values=hide` with the exact owner boundary. “Show the legend and values on Quarterly sales” shares the named chart. Quoted title content is a control.

A lexical inventory of the pinned diagram CSVs found 1,981 positional legend phrases, 397 explicitly introduced by “with”, and 200 direct add/show/hide/remove/lose phrases. Counts overlap and do not grade the rows. In the actual selected `23f19aa` cohort, native validation passed 35/35 and 28 leading proposals retained the intended legend result on the appropriate chart request (22 existing-chart edits and six creations). The seven remaining rows were `diagram/charts-02.csv:38,52,589` and `diagram/charts-01.csv:3764,3765,3804,3807`. They still expose “lose”, preamble, or creation-boundary gaps. Numeric, grid and display effects in the same compounds have their own checks; the legend counts alone do not grade the full utterance.

### READY Q-NL-053 — review request

Focused chart groups 7/7, final full serial suite 249/249 and final selected WebMeet run 35/35 native-valid with 28/35 intended legend results on the appropriate chart request. Please independently review and publish the scoped legend role change. Keep the latest aggregate table under Q045 separate from these targeted results.

## Q-NL-054 — Separate primary grouping, series fields and colour encodings

The catalog's existing `chart.dimension`, `chart.seriesDimension` and `chart.colourBy` now survive as independent operands. “Create a bar chart of sales by month, coloured by region and split by customer segment” retains month, region and customer segment in their written roles on one new chart. A bare “line chart of sales by month, split by category” uses the same role agreement without a manufactured predicate. “Split the Sales by Month chart by category” keeps the first “by” in the chart description and uses the second as the source-field cue. Quoted “Research and Development” remains one field, and the following draw command is independent.

An explicit chart showing how stations split by network retains stations as the subject and network as its primary dimension. It no longer fabricates a scene setting or a second series grouping in that construction. The secondary-series reading in chart creation requires an already stated grouping or series evidence. Non-chart paragraph splitting stays an ordinary take-apart request. Scatter “profit against sales” still needs independent source-axis binding; retaining the colour field alone does not complete that compound.

All 26 selected `23f19aa` inputs from `diagram/charts-01.csv` native-validate. Twenty leading proposals retain the selected field and the correct new-chart ownership: eight colour encodings (`:3717,3724,3728,3729,3755,3763,3766,3769`), four series fields (`:3792,3797,3802,3803`) and eight primary distribution dimensions (`:2513,2535,2558,2581,2620,2642,2683,2700`). The six remaining cases expose broader creation leads or preambles (`:3725,3726,3730,3767,3804,3809`). The lexical inventory found 193 colour-by and 399 split-by phrases in the pinned diagram CSVs; the latter count mixes primary distributions with secondary series. Neither count grades whole circuits.

### READY Q-NL-054 — review request

Focused chart groups 8/8 and final full serial suite 250/250. Please review and publish the scoped field roles, including the distinction between one distribution dimension and an additional series. In the owner output, keep these targeted results separate from the last aggregate L0–L4 table under Q045.

## Q-NL-055 — Bind scatter source axes and keep dependent chart clauses in scope

The reader now binds both source axes of a grounded scatter construction using the catalog's “salary against tenure” convention. The field before “against” supplies Y and the field after it supplies X, paired on the same new chart. It handles “plotted against”, field names in quotes, and a chart type that follows the operands. “Display profit against sales, coloured by region in a scatter plot” emits Y=profit, X=sales and colourBy=region. Explicit written regional qualifications such as “for the north region only” stay attached as exact unread evidence because there is no licensed filter binding in this scope. An independent drawing command remains separate. Ambiguous “versus” wording and non-scatter comparisons do not receive this directional reading.

The earlier reviewer counterexample came from the hierarchical segmenter cutting a chart edit that the lattice had already scoped, then re-reading the detached reason as an imperative. Stage 1 now preserves those chart spans, including the anchored operands of scoped chart creation, before slicing. The exact Revenue by region example emits the legend position and the request-owned “so the manager can read it”, followed by the actual dog-creation request. It is partial and has no fabricated load. A genuinely independent “read the Sales report” still emits load, and a quoted heading with the same reason text retains its written title.

All 16 selected `diagram/charts-01.csv` probes in published `23f19aa` native-validate. Eleven retain both written axes on the same new chart (`:3340,3341,3343,3344,3347,3348,3350,3357,3717,3724,3734`). Eight of those keep the exact regional clause unread, and three also retain the colour field. Row 3357 retains written `saels`; these are literal field-role checks. The other five (`:3354,3355,3356,3726,3730`) retain difficulties with indirect creation leads, narrative preambles and broader comparison syntax. The lexical inventory found 510 “against” and 123 “versus/vs” rows mentioning scatter across the pinned diagram CSVs, with possible overlap. These are candidate counts. Neither the lexical inventory nor the focused probes grade the entire utterance.

### READY Q-NL-055 — review request

Focused groups 10/10, final full serial suite 252/252, and final selected scatter run 16/16 native-valid with 11 paired axis results. Please independently review and publish the scatter bindings and Stage 1 scope safeguard. Include the exact dependent-read correction separately from the historical L0–L4 aggregate under Q045.
