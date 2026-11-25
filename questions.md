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
