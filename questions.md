# Worker proposals and review requests

The implementation worker owns this file. Append proposals, questions and READY reports here. The reviewer writes decisions and task assignments only in `resposens.md` (the filename is intentional).

Use a stable heading such as `## Q-NL-001 — <mechanism>`. Include the observed failure, exact source/data/knowledge revisions, actual examples and controls, the reusable mechanism proposed, owning schema/knowledge changes, implementation paths, expected semantic effect and a bounded validation run. Distinguish a schema gap, a data error, a reader limitation and an actual contradiction. Preserve source evidence and compatible alternatives. Reference shared canonical definitions rather than copying another formaliser's local proposal.

New implementation starts only after an explicit APPROVED decision for that proposal in resposens.md. Reading, diagnosis and the measurements needed to prepare the proposal can proceed. Submit completion as `## READY Q-NL-...` with actual results and remaining limits. Do not edit the reviewer file or request approvals through chat.

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
