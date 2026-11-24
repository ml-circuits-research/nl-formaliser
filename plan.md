# Plan: `nl-formaliser` — Formalizator Simbolic NL → SOP Lang bazat pe Z3

## 1. Ce am înțeles despre SOP Lang, `w.request` și scopul proiectului

### 1.1 Rolul SOP Lang în arhitectura `sopworlds`
În ecosistemul `sopworlds` (`soplang-words-lib`, `sop-knowledge-worlds`, `webmeet-dataset`, `psys2`), **SOP Lang** este reprezentarea declarativă unică (circuite de *wire*-uri tipate) care leagă limbajul natural de execuția deterministă și verificabilă într-o lume vie:

1. **Lumi de cunoștințe (`k.*`, `w.lang.en`)** în `sop-knowledge-worlds` (43 de lumi publicate, 35.182 de intrări în `vocab.json`): fapte reutilizabile despre acțiuni (`k.actions`: 19 acte, 62 roluri, 331 verbe), valori (`k.values`, `k.colours`, `k.shapes`), obiecte/părți/fețe/scene/layout-uri (`k.objects`, `k.parts`, `k.faces`, `k.body`, `k.people`, `k.animals`, `k.scenes`, `k.layouts`, `k.feelings`, `k.wearables`, `k.styles`, `k.diagrams`, `k.charts`, `k.genres`, `k.time`, `k.units`) și gramatica engleză (`w.lang.en`: clase închise, determinanți, pronume, prepoziții, conectori de clauze, cue-uri de constrângeri, morfologie, alternanțe, filler-e).
2. **Schema cererii (`w.request`)**: *ce a cerut utilizatorul este el însuși o lume*. Un formalizator (*reader*) nu judecă dacă cererea are sens în lumea fizică și nu inventează starea paginii — el traduce strict mesajul în wire-uri `w.request`:
   - `w.request.request` (`act`, `mode`, `mood`, `words`, `predicate`, `question`, `asked`, `asked_words`)
   - `w.request.target` (`request`, `family`, `mode`, `determiner`, `fill`, `sort`, `sort_words`, `name`, `name_words`, `description`, `count`, `count_words`, `quantifier`, `quantity`, `ordinal`, `code_words`, `ids`, `family_words`)
   - `w.request.constraint` (`request`, `on`, `attribute`, `value`, `words`, `key_words`, `operator`, `phase`, `want`, `character`, `step`, `measure`, `measure_words`, `unit`, `open_value`)
   - `w.request.lookup` (`request`, `target`/`constraint`, `key`, `from`)
   - `w.request.filler` (`text`)
   - `w.request.unread` (`request`, `text`, `note`, `value`)
   - `w.request.previous` (`text`) și `w.request.clock` (`now`, `timezone`) când există context explicit.
3. **Lumi vii (`w.drawing`, `w.diagram`, `w.document`, `w.calendar`, etc.)**: primesc circuitul `w.request`, rezolvă lookup-urile pe starea paginii, completează valorile implicite din `k.expect`, verifică fezabilitatea (inclusiv cu Z3 pentru plasare/programare) și execută sau refuză cu explicație.

### 1.2 Cele 3 reguli de aur ale unui circuit `w.request` (verificate de `webmeet-dataset/tools/check.mjs`)
1. **Evidență exactă (*Grounding*)**: fiecare wire păstrează cuvintele exacte din mesaj din care a fost citit; nu se inventează obiecte ale paginii (`context`/`thing`), `goes_to`, tipuri sau valori nescrise în text, și nu se duplică valori implicite (`words == value`, `sort_words == sort`, `request.words == text`).
2. **Acoperire completă**: fiecare cuvânt de conținut al mesajului trebuie să fie evidență a unui wire (`request`, `target`, `constraint`, `unread`) sau `filler` (doar politețe/ezitări/wrapper-e; cuvintele gramaticale din `w.lang.en` nu cer wire).
3. **Lipsurile se cer explicit prin `w.request.lookup`**: SOP Lang nu permite variabile libere (`?x`) în fapte; dacă ținta existentă nu este identificată de cuvintele textului (ex. `"make it blue"`, `"switch to the robot preset"`), circuitul emite `@r1.l1 w.request.lookup request=$r1 target=$r1.t key=thing from=page|previous`.

### 1.3 Ce am analizat concret în `webmeet-dataset` și `psys2/official-dataset`
Am inspectat schema, checker-ul și distribuția statistică a celor **189.021 de rânduri** din `webmeet-dataset` (și a split-urilor oficiale `psys2/official-dataset/dev.jsonl` = 8.577 rânduri, `test.jsonl` = 4.395 rânduri):

| Tab | Rânduri | Familii `w.request.key` | Chei declarate | Prioritate |
|---|---:|---|---:|---|
| `drawing` | 91.346 | `composition`, `drawn`, `group`, `page`, `part`, `preference`, `step` | 113 | P1 (principal) |
| `diagram` | 77.601 | `chart`, `composition`, `diagram`, `group`, `link`, `node`, `page`, `point`, `preference`, `series`, `sketch`, `step` | 213 | P1 (principal) |
| `document` | 12.028 | `block`, `document`, `inline`, `section`, `text` | 70 | P2 |
| `calendar` | 8.046 | `calendar`, `meeting`, `person`, `room` | 34 | P2 |
| **Total** | **189.021** | **28 familii tab-specifice** | **430 chei** | |

Fenomene dominante din eșantionul analizat (10% uniform pe toate cele 189k rânduri):
- **Acte**: `make` (~43%), `change` (~38%), `place` (~7%, inclusiv `mode=arrange`), `ask` (~4%), `remove` (~3%), `connect` (~1.6%), urmate de `undo`, `pick`, `group`, `redo`, `copy`, `take apart`, `save`.
- **Multi-request**: ~22% din mesaje au ≥ 2 cereri într-un singur text (`"move the house to 260,180, then make the house blue"`).
- **Lookup**: ~25% din mesaje cer `w.request.lookup` (referințe implicite/anaforice).
- **Filler**: ~48% din mesaje conțin `w.request.filler` (`please`, `can you`, `I want`, `um`, `let's`).
- **Constrângeri dominante**:
  - `drawing`: `drawn.relation` + `drawn.anchor`, `drawn.size` (`degree`/`delta`), `drawn.colour`, `drawn.at`, `drawn.count`, `drawn.facing`, `drawn.pose`, `part.variant`/`part.colour`/`part.owner`/`part.size`, `drawn.expression`, `page.scene`/`page.time`/`page.weather`.
  - `diagram`: `chart.type`, `chart.dimension`, `chart.measure`, `chart.labels`, `chart.aggregate`, `chart.title`, `chart.legend`, `chart.sort`, `chart.grid`, `node.ids`, `node.label`, `node.colour`, `node.position` + `node.anchor`, `link.from` + `link.to`, `diagram.kind`.
  - `document`: `section.content`, `block.id`/`section.id`, `text.about`/`text.title`/`text.words`/`text.content`, `section.order` + `section.order_anchor`, `block.level`/`block.style`/`block.align`/`block.mark`.
  - `calendar`: `meeting.day`, `meeting.time`, `meeting.timezone`, `meeting.title`, `meeting.length`, `meeting.calendar`, `meeting.room`, `meeting.people`, `calendar.name`.

### 1.4 Calitatea adnotărilor din dataset (de ce Z3 poate produce rezultate *mai bune*)
Inspectând exemple reale din `webmeet-dataset`, am confirmat exact observația ta:
- **Multi-request hull bugs**: ex. `"can you move the house to 260,180 and then make the house blue?"` are în gold `@r2 words="the house to 260,180 and then make the house blue"` și `name="the house"` în loc de `words="make the house blue"` și `sort=house`.
- **Cuvinte cu chei reale aruncate în `filler` sau `unread`**: ex. `"bar graph, orange horizontal .6; name Power; x on top; invert y"` are în gold `@f1 filler text=x` și `@f2 filler text="top; invert y"`, deși `keys.sop` declară `chart.xAxis=top` și `chart.invert=y`. Similar `"big apple tree on left side, top and left cut."` pune `"top and left cut"` în filler deși există `drawn.edge` și `drawn.cut`.
- **Warning-uri existente în dataset** (documentate chiar în `webmeet-dataset/README.md`): 85.793 cuvinte de conținut neacoperite, 29.849 sensuri rămase `unread`, 3.803 nume proprii pierdute.

Prin urmare, evaluatorul nu trebuie să judece strict după egalitatea brută de string cu gold-ul, ci să măsoare atât **validitatea formală & acoperirea completă (`check.mjs` + `sopworld`)**, cât și **alinierea semantică**, evidențiind separat cazurile în care **formalizarea Z3 este obiectiv mai curată/completă decât adnotarea**.

---

## 2. Principiul Arhitectural Central: Logica stă în Z3, Node.js (`.mjs`) este wrapper subțire

### 2.1 De ce Z3 (MaxSMT / SMT-LIB2) este ideal pentru formalizarea NL → SOP Lang
Formalizarea unui enunț natural într-un circuit `w.request` nu este un pipeline greedy de regex-uri, ci o **problemă globală de satisfacere de constrângeri și optimizare (Weighted MaxSMT)** în care toate deciziile interacționează simultan:

- **Segmentarea în cereri**: `"and"` desparte 2 cereri în `"move the house left and make it blue"`, dar coordonează în interiorul unei singure cereri în `"group o1 and o2"` sau `"red and blue house"`.
- **Dezambiguizarea actului**: `"make a red house"` → `act=make, mode=new` vs `"make the house red"` → `act=change, mode=existing`.
- **Dezambiguizarea cuvintelor polisemice**: `"orange"` (culoare `drawn.colour` vs fruct `sort=orange`); `"left"` (direcție `drawn.direction`, regiune `drawn.at`, margine `drawn.edge`, parte axă `chart.axisSide`, verb); `"top"` (`drawn.at`, `chart.xAxis`, `chart.legend`, `section.order`).
- **Coerența familie ↔ atribute**: dacă apare `"nose"`/`"hair"` (`family=part`), atunci `"bigger"` și `"red"` trebuie să se lege la `part.size` și `part.colour`, nu la `drawn.size`/`drawn.colour`. Dacă apare `"bar chart"` (`family=chart`), `"title"`/`"colour"`/`"left"` se leagă la `chart.*`, nu la `node.*`.
- **Separarea `phase=selector` vs `phase=result`**: în `"make the red house blue"`, `"red"` este `selector` (identifică ținta existentă), iar `"blue"` este `result` (starea dorită); în `"add a red house"`, `"red"` este `result`.
- **Acoperirea tuturor cuvintelor fără halucinații**: fiecare cuvânt de conținut trebuie explicat de o ipoteză validă sau lăsat explicit ca `w.request.unread` (cu penalitate mare în MaxSMT).

### 2.2 Cum garantăm că *logica stă în Z3*, nu în cod custom JS
Am verificat deja direct în mediul curent (Node `v22.23.2` + `z3-solver` WASM):
- Inițializare Z3 WASM: **~93 ms** o singură dată pe proces.
- Rezolvare MaxSMT direct în **SMT-LIB2** (`assert-soft` + `(push)...(pop)` prin `Z3.eval_smtlib2_string`): **~5,4 ms / enunț**.

Asta ne permite o arhitectură extrem de curată și transparentă:

```text
  text + tab (+ optional previous/clock)
                    │
                    ▼
  ┌──────────────────────────────────────────────────────┐
  │ 1. Knowledge Loader (src/kb/*.mjs)                   │  ◄── Citește direct din ../sop-knowledge-worlds
  │    - w.request/schema.sop + shards/keys.sop (430)    │      (zero liste hardcodate de domeniu)
  │    - k.actions (acte, verbe, marcaje)                │
  │    - w.lang.en (closed, det, prep, cues, skip, morph)│
  │    - k.* (colours, values, objects, shapes, faces,   │
  │      body, people, animals, scenes, layouts, styles) │
  └─────────────────────────┬────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────┐
  │ 2. Lexical Lattice Generator (src/lattice/*.mjs)     │  ◄── Wrapper pur lexical (NU ia decizii semantice!)
  │    - Tokenizare cu offset-uri exacte în text         │
  │    - Lematizare din w.lang.en                        │
  │    - Enumeră TOATE ipotezele candidate pe span-uri   │
  │      (filler, grammar, predicate, sort, family,      │
  │       key_word, value, neg, prep/cue, open-span,     │
  │       fallback unread)                               │
  └─────────────────────────┬────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────┐
  │ 3. Z3 Formalisation Engine (smt/*.smt2 + z3-runner)  │  ◄── TOATĂ LOGICA DE DECIZIE STĂ AICI!
  │    - Axiome declarative SMT-LIB2 (w.request +        │
  │      gramatică + reguli de grounding & coerență)     │
  │    - Optimizare MaxSMT (assert-soft)                 │
  │    - Suport nativ: Top-K alternative (blocking       │
  │      clauses) & Unsat Core (explicații formale)      │
  └─────────────────────────┬────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────┐
  │ 4. Deterministic Projection & Verification (.mjs)    │  ◄── Fără logică de raționament
  │    - Model Z3 → wire-uri canonice SOP Lang           │
  │    - Validare prin sopworld + regulile check.mjs     │
  └──────────────────────────────────────────────────────┘
```

**Regulă strictă de disciplină de cod**:
- Codul JS din `src/lattice/` are voie doar să **propună candidați** din cunoștințele declarate (dacă un cuvânt are 4 interpretări posibile, le trimite pe toate 4 în Z3). Nu are voie să aleagă între ele cu `if/else`.
- Codul JS din `src/smt/encode.mjs` traduce mecanic structura laticei și tabela `keys.sop` a tab-ului în declarații SMT-LIB2 peste axiomele din `smt/*.smt2`.
- Codul JS din `src/emit/to-sop.mjs` citește atribuirea din modelul Z3 și tipărește wire-urile SOP Lang.

---

## 3. Modelul Formal Z3 (SMT-LIB2 MaxSMT)

### 3.1 Sorturi și variabile SMT-LIB2
Fișierul declarativ `smt/prelude.smt2` definește tipurile finite (Algebraic Datatypes în SMT-LIB2, verificate de tip de către Z3):
- `Act`: `ACT_MAKE`, `ACT_CHANGE`, `ACT_PLACE`, `ACT_REMOVE`, `ACT_ASK`, `ACT_CONNECT`, `ACT_GROUP`, `ACT_TAKE_APART`, `ACT_PICK`, `ACT_COPY`, `ACT_UNDO`, `ACT_REDO`, `ACT_SAVE`, `ACT_LOAD`, `ACT_SEND`, `ACT_DESELECT`
- `ActMode`: `MODE_NONE`, `MODE_ARRANGE`, `MODE_MERGE`, `MODE_UNGROUP`, `MODE_SPLIT`, `MODE_DISCONNECT`, `MODE_REVERSE`, `MODE_SET`, `MODE_REPEAT`
- `Mood`: `MOOD_DO`, `MOOD_ASK`, `MOOD_CHECK`, `MOOD_PROPOSE`
- `Question`: `Q_NONE`, `Q_COUNT`, `Q_EXISTS`, `Q_LIST`, `Q_WHAT`, `Q_WHICH`, `Q_WHERE`, `Q_WHEN`, `Q_WHO`, `Q_DESCRIBE`, `Q_WHY`, `Q_HOW`, `Q_HOW_MUCH`, `Q_COMPARE`, `Q_TOTAL`, `Q_AVERAGE`, `Q_MAX`, `Q_MIN`, `Q_DIFFERENCE`, `Q_PERCENT`
- `TargetMode`: `TM_NEW`, `TM_EXISTING`, `TM_BOUND`
- `TargetFill`: `TF_NONE`, `TF_WRITTEN`, `TF_CONTEXT`, `TF_DESCRIPTION`, `TF_ALL`, `TF_JOURNAL_STEP`
- `Det`: `DET_NONE`, `DET_DEFINITE`, `DET_INDEFINITE`, `DET_QUANTIFIED`, `DET_POSSESSIVE`, `DET_DEMONSTRATIVE`
- `Phase`: `PH_RESULT`, `PH_SELECTOR`
- `Want`: `W_YES`, `W_NO`, `W_NOT_ALL`
- `Family` (dinamic per tab din `w.request/shards/keys.sop`) și `AttrId` (indecșii cheilor tab-ului curent).

Pentru un enunț cu `T` tokeni (`0..T-1`), `M` ipoteze candidate (`0..M-1`) și maxim `R` sloturi de cerere (`1..R`, unde `R = min(6, 1 + nr_puncte_de_tăiere)`):
- **Pe cerere `r ∈ 1..R`**:
  - `active_r : Bool` (cu `active_1 = true` și `active_{r+1} => active_r`)
  - `act_r : Act`, `amode_r : ActMode`, `mood_r : Mood`, `q_r : Question`, `asked_r : Int` (`-1` = niciuna, altfel `AttrId`)
  - `fam_r : Family`, `tmode_r : TargetMode`, `tfill_r : TargetFill`, `tdet_r : Det`, `lookup_r : Bool`
  - `rstart_r : Int`, `rend_r : Int` (intervalul de tokeni al cererii `r`), `tpos_r : Int` (poziția capului țintei în cererea `r`, `-1` dacă implicită)
- **Pe ipoteză candidată `h ∈ 0..M-1`** (cu span fix cunoscut `[s_h, e_h]` și rol fix cunoscut):
  - `sel_h : Bool` (ipoteza este aleasă în formalizare)
  - `own_h : Int` (`0` = în afara oricărei cereri, ex. filler/joiner extern; `1..R` = aparține cererii `r`)
- **Pe ipoteză de constrângere `c`**:
  - `phase_c : Phase`, `want_c : Want`
  - `kw_c : Int` (indicele ipotezei `KEY_WORD` legate la această constrângere, sau `-1`)
  - `anc_c : Int` (pentru constrângeri de relație/ordine: legătura cu ipoteza anchor, dacă există)

### 3.2 Axiome Hard (garantează validitate `w.request` prin construcție)
1. **Non-suprapunere și acoperire de conținut (Evidență + 0 cuvinte pierdute)**:
   - Pentru orice doi candidați primari care se suprapun pe cel puțin un token: `¬(sel_h1 ∧ sel_h2)`.
   - Pentru orice token `t` care NU este cuvânt gramatical pur (`w.lang.en.closed`/`skip`-grammar): `⋁_{h acoperă t} sel_h`. (Întotdeauna satisfiabil deoarece există candidat fallback `UNREAD` cu cost mare.)
   - **Puritatea filler-elor**: un candidat `FILLER` cu `own_h > 0` (în interiorul unei cereri) poate fi selectat doar dacă acoperă exclusiv tokeni de filler/gramatică; filler-ele cu cuvinte de conținut (remarci externe) sunt permise doar cu `own_h = 0` (în afara span-urilor cererilor).
2. **Segmentare contiguă și monotonă a cererilor**:
   - `sel_h ∧ own_h = r => active_r ∧ rstart_r ≤ s_h ∧ e_h ≤ rend_r`.
   - Ordonare strictă între cereri active: `active_{r+1} => rend_r < rstart_{r+1}`.
   - Între două cereri consecutive `r` și `r+1`, trebuie să existe un separator de clauză (`comma`, `semicolon`, `period`, `and`, `then`, `also`, `but`, `afterwards`, `next`) sau începutul explicit al unei noi clauze cu predicat propriu.
   - Cel puțin un predicat sau o constrângere/țintă pe fiecare cerere activă (fără cereri goale).
3. **Acord Act – Predicat – Mood – Question**:
   - Cel mult un predicat principal per cerere `r`.
   - Dacă predicatul `p` este selectat pentru cererea `r`, atunci `(act_r, amode_r)` trebuie să aparțină setului de perechi licențiate de `k.actions.verb` (și `w.lang.en` phrasal verbs / question triggers). Ex.: `"delete"` nu poate primi niciodată `ACT_MAKE` sau `ACT_CHANGE`.
   - `mood_r ∈ {MOOD_ASK, MOOD_CHECK} => act_r = ACT_ASK`; `mood_r = MOOD_DO => q_r = Q_NONE`.
   - Dacă `asked_r ≥ 0`, atunci `act_r = ACT_ASK` și trebuie selectat un `KEY_WORD` care numește atributul `asked_r` (pentru `asked_words`).
4. **Coerența Țintei & Legea Lookup-ului (teoremă hard)**:
   - `act_r = ACT_MAKE => tmode_r = TM_NEW` (dacă verbul `"make"` are și sens `ACT_CHANGE` în `k.actions`, Z3 alege între `(ACT_MAKE, TM_NEW)` și `(ACT_CHANGE, TM_EXISTING)` în funcție de prezența determinanților și a predicatului rezultativ!).
   - `act_r ∈ {ACT_CHANGE, ACT_REMOVE, ACT_PLACE, ACT_PICK, ACT_COPY, ACT_GROUP, ACT_TAKE_APART, ACT_UNDO, ACT_REDO} => tmode_r ≠ TM_NEW`.
   - `tmode_r = TM_NEW => tfill_r = TF_NONE ∧ ¬lookup_r`.
   - `identified_r` este adevărat exact când în cererea `r` este selectat un candidat de `TARGET_SORT`, `TARGET_NAME`, `TARGET_CODE`, `TARGET_DESCRIPTION` sau `TARGET_COUNT`.
   - **Legea Lookup-ului** (identică cu `check.mjs` linia 140):
     `tmode_r ≠ TM_NEW ∧ tfill_r ≠ TF_ALL ∧ ¬identified_r => lookup_r = true`.
   - Sursa lookup-ului (`from=previous` vs `from=page`): dacă există `@prev` sau indiciu de istoric (`fill=journal_step`, `"last change"`), `from=previous`, altfel `from=page`.
5. **Coerența Tab – Familie – Atribut – Valori închise**:
   - Fiecare constrângere selectată `c` are `attribute` declarat în `w.request/shards/keys.sop` pentru tab-ul activ.
   - Relația de compatibilitate `compat(fam_r, attr_family(c))`: în mod standard `fam_r = attr_family(c)`, plus excepțiile declarate în schemă (ex. `page.*` permis pe cereri de scenă/pagină; `drawn.relation`/`drawn.anchor` permise la mutarea unei părți relativ la un obiect; `section.order*` permis pe `block`).
   - Pentru chei cu listă închisă (`head=class`), orice valoare trebuie să fie în lista închisă a cheii sau marcată explicit `open_value=true` (cu penalitate în obiectiv).
   - **Anti-halucinare chart measure/dimension** (`check.mjs` linia 245): candidații pentru `chart.measure` / `chart.dimension` nu pot consta exclusiv din cuvinte gramaticale sau verbe active de comandă.
6. **Legarea `KEY_WORD` + `VALUE` (Binding declarativ)**:
   - Un candidat `KEY_WORD(attr)` selectat în cererea `r` trebuie fie să se lege la o constrângere `c` din aceeași cerere cu același atribut (`kw_c = k ∧ attr(c) = attr(k)`), fie să fundamenteze `asked_r = attr(k)` (în întrebări `"what colour is..."`), fie să marcheze un `key_words` de țintă (`name_words` `"called"`, `family_words` `"chart"`). Nu poate rămâne suspendat.
7. **Separarea `phase=selector` vs `phase=result` & Negația**:
   - Dacă `tmode_r = TM_NEW`, toate constrângerile obișnuite au `phase_c = PH_RESULT`.
   - Dacă `tmode_r = TM_EXISTING`:
     - Modificatorii pre-nominali atașați capului țintei (`s_c < tpos_r` în același NP) și cheile de selecție (`*.id`, `*.ids`, `*.anchor`) primesc `PH_SELECTOR`.
     - Modificatorii post-verbali/predicativi (`s_c > tpos_r` sau introduși de `"to"`, `"as"`, `"into"`, sau după copula `"be"`) primesc `PH_RESULT`.
   - **Legea verbelor de păstrare (`keep`/`leave`/`spare`)**: dacă `act_r = ACT_REMOVE` cu predicat de păstrare și există constrângere `PH_SELECTOR`, cel puțin un selector trebuie să aibă `want_c = W_NO` (exact regula din `check.mjs` linia 260).
   - **Negația (`not`, `no`, `without`, `not all`, `don't`)**: un candidat `NEG` selectat se leagă de constrângerea imediat următoare din aceeași cerere setând `want_c = W_NO` sau `W_NOT_ALL` (sau o valoare închisă de tip `hide`/`off`/`none` când cheia o suportă).
8. **Cadre structurale compuse & Non-duplicare**:
   - Nu se pot selecta două constrângeri identice `(attribute, value, operator, phase, want)` în aceeași cerere.
   - Coordonate (`260,180`) → emit perechea `*.x` + `*.y` atomic în aceeași cerere.
   - Relații spațiale/temporale/de ordine (`above/below/near/left_of/before/after` + NP următor) → leagă `*.relation` + `*.anchor` (sau `node.position` + `node.anchor`, `section.order` + `section.order_anchor`, `meeting.relation` + `meeting.relation_anchor`).
   - Legături graf (`from X to Y`, `connect X and Y`) → leagă `link.from` + `link.to` (sau `link.nodes`) cu `fam_r = link`.
   - Comparative (`much bigger`, `a bit shorter`, `twice as large`) → `operator=delta` + `step ∈ {more, much_more, less, much_less}` sau `operator=factor`, derivate din `k.values.comparative` + `k.values.scale` (`degree`).

### 3.3 Obiectivul MaxSMT (`assert-soft` în Z3)
Z3 minimizează suma penalităților (un set mic și transparent de ponderi globale — **zero reguli per propoziție**):

| Termen soft | Pondere (cost) | Efect semantic |
|---|---:|---|
| Token de conținut lăsat `UNREAD` | `100 / token` | Forțează formalizarea oricărui sens cunoscut, dar permite onest `w.request.unread` când lipsește cheia |
| Valoare `open_value=true` pe cheie cu listă | `35` | Preferă potrivirea pe lista închisă / `k.values` / `k.colours` înainte de fallback open |
| Deschiderea unei cereri suplimentare (`active_r`, `r > 1`) | `30` | Parsimonie: nu sparge `"red and blue"` în 2 cereri, dar sparge imediat când al doilea predicat ar deveni `UNREAD` (`100 > 30`) |
| Cerere fără predicat explicit (elipsă verbală) | `18` | Preferă cererile cu verb (`"draw a cat"`), dar permite fragmente valide (`"bar graph, orange"`, `"bigger"`) |
| `lookup_r = true` | `15` | Preferă identificarea țintei din cuvintele textului (`sort=house`) față de lookup implicit, când textul chiar o numește |
| Potrivire fragmentată vs frază multi-cuvânt | `+8 / span` | Preferă natural span-ul cel mai lung și specific (`"top left"` > `"top"` + `"left"`, `"apple tree"` > `"apple"` + `"tree"`, `"bar chart"` > `"bar"` + `"chart"`) |
| Legare explicită `KEY_WORD + VALUE` | `-12` (bonus) | Preferă să lege `"colour"` + `"blue"` într-un singur constraint cu `key_words=colour` |
| Coerență strictă de familie (`attr_fam == fam_r`) | `-10` (bonus) | Trage toate atributele pe familia cea mai coerentă global |
| Ambiguitate `sort` vs `name` (cuvânt cunoscut în `k.objects` vs nume propriu) | `-8` pentru `sort` (dacă lowercase), `-8` pentru `name` (dacă capitalizat/citat/după `called`/`labelled`) | Rezolvă curat `"the house"` (`sort=house`) vs `"Sri"` / `"Report"` / `"called Start"` (`name=...`) |

### 3.4 Top-K Alternative și Diagnostice Formale
- **Top-K (`topK > 1`)**: după prima soluție optimă, adăugăm o clauză de blocare peste vectorul de decizie `(active_r, act_r, fam_r, sel_h)` și rulăm din nou `(check-sat)` — obținem instant ipoteze alternative ordonate după scor (aliniat principiului Review29).
- **Unsat Core**: dacă un set de constrângeri hard intră în conflict (bug în axiome sau constrângere imposibilă), modul de debug rulează `Solver` cu `assert (! ... :named ...)` și `(get-unsat-core)` pentru a indica exact axioma vinovată.
- **Inspectabilitate**: flag-ul `--dump-smt` salvează fișierul `.smt2` complet generat pentru orice propoziție, rulabil independent cu orice Z3 standard.

---

## 4. Structura proiectului `nl-formaliser`

Toată implementarea este în Node.js ES modules (`.mjs`) + fișiere declarative SMT-LIB2 (`.smt2`), fără dependențe grele (doar `z3-solver` și citirea directă a `sop-knowledge-worlds` + `sopworld.mjs`):

```text
nl-formaliser/
├── package.json                  # "type": "module", scripts (test, bench, formalise)
├── plan.md                       # Acest plan
├── README.md                     # Documentație de utilizare și arhitectură
├── smt/
│   ├── prelude.smt2              # Sorturi SMT-LIB2 (Act, Mood, Question, TargetMode, Phase, Want...)
│   └── axioms.smt2               # Macro-uri / funcții declarative Z3 (acord act-target, lookup law, phase)
├── src/
│   ├── kb/
│   │   └── load-worlds.mjs       # Încarcă dinamic w.request/keys.sop, k.actions, w.lang.en, k.*
│   ├── lattice/
│   │   ├── tokenize.mjs          # Tokenizare cu offset-uri exacte, punctuație, ghilimele, coduri, numere
│   │   ├── morph.mjs             # Lematizare / singularizare din w.lang.en (morphology + irregulars)
│   │   └── candidates.mjs        # Construiește laticea nefiltrată de ipoteze (filler, grammar, pred, sort, key, val, open, unread)
│   ├── smt/
│   │   ├── encode.mjs            # Traduce laticea + cheile tab-ului în problemă SMT-LIB2 MaxSMT
│   │   └── z3-runner.mjs         # Wrapper subțire pe z3-solver WASM (context persistent, push/pop, timeout, top-K, dump)
│   ├── emit/
│   │   └── to-sop.mjs            # Proiecție deterministă model Z3 → circuit SOP Lang canonic (w.request)
│   ├── verify/
│   │   └── check.mjs             # Verificator integrat (sopworld w.request + k.actions + regulile webmeet check.mjs)
│   └── index.mjs                 # API public: createFormaliser({ knowledgeDir }) → formalise(text, opts)
├── bin/
│   └── formalise.mjs             # CLI: node bin/formalise.mjs --tab drawing "make the house blue" [--dump-smt] [--top 3]
├── eval/
│   ├── compare.mjs               # Comparare semantică + alias-uri + clasificator "better-than-gold"
│   └── benchmark.mjs             # Runner stratificat pe webmeet-dataset, official-dataset/test.jsonl și keys.sop
└── test/
    ├── kb.test.mjs               # Teste unitare Knowledge Loader
    ├── lattice.test.mjs          # Teste unitare Tokenizer + Lattice
    ├── z3-core.test.mjs          # Teste axiome Z3 (disambiguare, lookup law, multi-request, phase, unsat-core)
    └── e2e-smoke.test.mjs        # Smoke suite pe toate cele 4 tab-uri + verificare 0 erori check.mjs
```

---

## 5. Strategia de Evaluare și Benchmark-uri

Vom evalua continuu formalizatorul pe **3 niveluri de benchmark-uri**, toate disponibile local în workspace:

1. **Nivel 1 — Micro-suite declarative (`sop-knowledge-worlds`)**:
   - Exemplele inline din toate cele **430 declarații `w.request.key`** (`docs/worlds/w.request/shards/keys.sop`).
   - Exemplele de frame-uri și template-uri din `w.lang.en` (`386` frame examples, `68` templates, `35` alternations).
   - Cazuri contrastante (perechi minime: `"make a red house"` vs `"make the house red"`, `"move the red box left"` vs `"move the box to the left"`, `"draw an orange"` vs `"make it orange"`, `"keep two of the trees"`, multi-request vs coordonare).
2. **Nivel 2 — Split-urile oficiale de antrenare/test (`psys2/official-dataset/`)**:
   - `dev.jsonl` (8.577 rânduri) pentru dezvoltare și analiza clusterelor de erori.
   - `test.jsonl` (4.395 rânduri) **păstrat curat pentru raportarea finală** (held-out).
3. **Nivel 3 — Eșantion stratificat din `webmeet-dataset` (189.021 rânduri)**:
   - Eșantion rapid de iterație (ex. 400 rânduri: 150 drawing, 150 diagram, 50 document, 50 calendar, acoperind toate temele: `objects`, `placement`, `people`, `scenes`, `charts`, `nodes`, `diagrams`, `text`, `meetings` + `ui-coverage`, `ui-human`, `ui-natural`, `ui-comparatives`, `human-adapted-*`).
   - Rulare extinsă (2.000–5.000 rânduri stratificate + întregul `test.jsonl` de 4.395 rânduri — la ~10-20 ms/enunț în Z3, întregul `test.jsonl` rulează în sub ~1,5 minute, sau ~20s paralelizat pe worker threads!).

### Metrici raportate la fiecare iterație
- **A. Conformitate & Grounding (`check.mjs` + `sopworld`)**:
  - `schema_ok %` (țintă: **≥ 99.5% – 100%** — garantat prin axiomele hard Z3)
  - `zero_warnings %` (0 cuvinte de conținut neacoperite, 0 nume proprii pierdute, 0 contradicții act-predicat, 0 unread invalide) — comparat direct cu `zero_warnings %` al gold-ului!
- **B. Aliniere semantică cu gold-ul**:
  - `request_count_exact %`
  - `act_exact %`, `act_mode_exact %`, `mood_exact %`, `question_exact %`
  - `target_family_exact %`, `target_mode_exact %`, `target_sort_or_name_f1`, `lookup_f1`
  - `constraint_attr_f1`, `constraint_attr_val_f1` (strict + normalizat pe alias-uri de chei precum `drawn.color`/`drawn.colour`, `chart.showValues`/`chart.show_values`/`chart.valueLabels`, `chart.horizontal=on`/`chart.orientation=horizontal`)
- **C. Audit „Mai bun decât gold” vs „Gap real Z3”**:
  - Fiecare diferență este clasificată automat:
    1. `z3_cleaner_than_gold`: Z3 produce 0 erori/warning-uri și formaliza o cheie validă acolo unde gold-ul avea cuvinte neacoperite, `unread`, `filler` greșit sau `hull` eronat.
    2. `equivalent_alias`: aceeași semantică exprimată printr-o cheie alias validă din `keys.sop`.
    3. `genuine_gap`: eroare reală de formalizare (grupată pe tip: lipsă vocabular din `k.*`, lipsă cadru structural, eroare de segmentare, eroare de fază/act/familie) → intră în bucla de rafinare generală.

---

## 6. Plan de Execuție pe Etape și Delegare către Subagenți

Pentru eficiență de cost și paralelism, **modelul principal** deține contractele, modelarea formală Z3 (`smt/*.smt2` + `encode.mjs`), integrarea și analiza erorilor, iar componentele bine delimitate și independente sunt delegate la **subagenți mai mici și mai ieftini (`flash` / `flash_lite`)** cu ownership disjunct de fișiere:

### Faza 0 — Bootstrap & Contracte (Primary)
- Creare `package.json` (`"type": "module"`, rezolvare `z3-solver` local din workspace sau `npm install`, dependență opțională/locală pe `sopworld.mjs`).
- Fixarea contractului de date JSON dintre cele 4 etape: `KnowledgeIndex`, `Token`, `CandidateHypothesis`, `Z3Solution`, `CheckResult`.

### Faza 1 — Infrastructură paralelă (3 subagenți `flash` în paralel + Primary pe nucleul Z3)
- **Subagent 1 (`flash`) — `src/kb/load-worlds.mjs` + `test/kb.test.mjs`**:
  - Citește dinamic din `../sop-knowledge-worlds/docs/worlds/`: `w.request/shards/keys.sop`, `k.actions/shards/*.sop`, `w.lang.en/shards/*.sop`, `k.colours`, `k.values`, `k.shapes`, `k.objects`, `k.body`, `k.faces`, `k.people`, `k.animals`, `k.scenes`, `k.layouts`, `k.feelings`, `k.wearables`, `k.styles`, `k.diagrams`, `k.charts`, `k.genres`, `k.units`, `k.time`, plus cuvintele `core.word` din schemele tab-urilor (`w.drawing`, `w.diagram`, `w.document`, `w.calendar`, `w.face`, `w.chart`).
  - Construiește indexuri rapide (Map/Trie) pentru verbe/phrasal verbs, chei per tab, liste de valori închise, cuvinte de chei (`key_words`), cuvinte de familie (`family_words`), sort-uri, culori, scale/comparative, direcții, poziții, prepoziții, determinanți, cue-uri, filler-e, gramatică, reguli morfologice.
- **Subagent 2 (`flash`) — `src/lattice/tokenize.mjs`, `src/lattice/morph.mjs`, `src/lattice/candidates.mjs` + `test/lattice.test.mjs`**:
  - Tokenizare fără pierdere de offset-uri, detectare numere/coordonate/date/ore/coduri/citate/nume proprii.
  - Generare latice nefiltrată de candidați multi-cuvânt și single-word (fără decizii de dezambiguizare).
- **Subagent 3 (`flash`) — `src/verify/check.mjs`, `eval/compare.mjs`, `eval/benchmark.mjs`**:
  - Wrapper de validare peste `sopworld` (`w.request` + `k.actions`) + regulile de grounding/warnings din `webmeet-dataset/tools/check.mjs`.
  - Evaluator pe CSV (`webmeet-dataset`) și JSONL (`psys2/official-dataset/{dev,test}.jsonl`) cu metrici complete + bucket „mai bun decât gold”.
- **Primary — `smt/prelude.smt2`, `smt/axioms.smt2`, `src/smt/encode.mjs`, `src/smt/z3-runner.mjs`, `src/emit/to-sop.mjs`, `src/index.mjs`, `bin/formalise.mjs` + `test/z3-core.test.mjs`**:
  - Implementarea completă a modelului MaxSMT descris în §3 și integrarea end-to-end.

### Faza 2 — Vertical Slice & Baseline Măsurat (Primary)
- Rulare end-to-end pe suita smoke + eșantion stratificat de 400 rânduri din `webmeet-dataset` (100/tab) + exemplele `keys.sop`.
- Verificare 100% conformitate `check.mjs` (0 erori de schemă/grounding).
- Obținerea primului raport real de benchmark și a top-20 clustere de discrepanțe.

### Faza 3 — Rafinare iterativă pe Prioritatea 1: `drawing` & `diagram` (Primary + subagenți `flash` pentru extindere lexicală/teste)
- **Iterația Drawing**: relații spațiale + ancore (`drawn.relation` + `drawn.anchor`), comparative și pași (`drawn.size`/`width`/`height` + `delta`/`step`), coordonate (`drawn.x`/`drawn.y`), oameni și părți (`part.*`, `part.owner`, `part.variant`, `drawn.pose`, `drawn.expression`, `drawn.facing`, `drawn.trait`, `drawn.preset`), scenă/timp/vreme/stil/filtru (`page.*`), multi-request.
- **Iterația Diagram**: grafice (`chart.type`, `chart.measure`, `chart.dimension`, `chart.aggregate`, `chart.labels`, `chart.values`, `chart.title`, `chart.legend`, `chart.axis*`, `chart.grid*`, `chart.sort`), noduri și legături (`node.*`, `link.from`/`link.to`/`link.arrow`/`link.style`, `group.*`, `diagram.kind`/`layout`/`theme`), coduri (`n1`, `a1`, `g1`, `c1`).
- Fiecare fix este verificat să fie **o axiomă Z3 generală sau un binding din `sop-knowledge-worlds`**, niciodată un patch pe o propoziție.

### Faza 4 — Extindere pe Prioritatea 2: `document` & `calendar` (Primary + subagenți `flash`)
- **Document**: `section.*`, `block.*`, `text.*`, `inline.*` (titluri, conținut, ordine `before`/`after` + `order_anchor`, aliniere, nivel heading, liste, tabele, marcaje bold/italic/highlight).
- **Calendar**: `meeting.*`, `calendar.*`, `room.*`, `person.*` (date ISO și relative, ore, intervale `from X to Y`, timezone, durate, shift-uri comparative `"a bit later"`, participanți, săli, `@clock`).

### Faza 5 — Evaluare Finală & Raport Complet (Primary + subagent `flash` pentru audit manual al eșantionului)
- Rulare pe întregul **`psys2/official-dataset/test.jsonl` (4.395 rânduri)** + eșantion mare stratificat din `webmeet-dataset` + suita `w.lang.en`.
- Audit pe 40+ cazuri de discrepanță (exemple concrete „Z3 mai bun decât gold” vs „limitări oneste rămase”).
- Raport final cu cifre măsurate (acuratețe, F1, validitate, warning-uri, latență p50/p95 în Z3) și listă onestă de mecanisme generale rămase deschise.

---

## 7. Riscuri Tehnice și Mitigări

| Risc | Impact | Mitigare în design |
|---|---|---|
| **Explozia combinatorie în Z3** pe mesaje lungi (40+ tokeni, 4+ cereri) | Latență > 500 ms sau timeout | Limitare curată a ferestrei de atașare (ex. `key_word` se poate lega de o valoare din aceeași clauză; prepoziție de span-ul imediat următor), tăierea candidaților dominați strict imposibili pe tab-ul curent, timeout Z3 per enunț (ex. 2000 ms) cu fallback curat pe segmentare pe clauze individuale. |
| **Span-uri deschise (*open spans*)** precum titluri, nume proprii, `chart.measure`/`dimension`, `drawn.anchor`, `text.content` | Sub-segmentare sau supra-capturare | Generarea sistematică a candidaților de span din marcatori declarați (`w.lang.en.prep`, `w.lang.en.cue`, `key_words`, ghilimele, capitalizare) până la frontiere sintactice; Z3 alege frontiera optimă global care maximizează acoperirea fără a fura tokeni din alte constrângeri. |
| **Sinonime și chei redundante în `keys.sop`** (ex. `drawn.color` vs `drawn.colour`, `chart.showValues` vs `chart.show_values` vs `chart.valueLabels`) | Fals-negativ la comparația cu gold | Alegem o cheie canonică consistentă în Z3 (conformă cu `keys.sop` și `check.mjs`), iar evaluatorul raportează atât scorul strict, cât și scorul alias-normalizat. |
| **Cuvinte care lipsesc din `sop-knowledge-worlds`** (ex. sinonime informale sau termeni de grafice din `data-drop`) | Ajung în `w.request.unread` | Nu hardcodăm liste ad-hoc în JS; folosim `open_value=true` acolo unde structura gramaticală + `key_word` indică clar atributul, lăsăm restul onest în `w.request.unread` și raportăm gap-urile de cunoștințe care merită adăugate în `sop-knowledge-worlds`. |
| **Performanță pe benchmark-uri de mii de rânduri** | Evaluare lentă | Reutilizăm un singur context Z3 per proces cu `(push)...(pop)` (~5–20 ms/enunț verificat) și putem rula `benchmark.mjs` pe `worker_threads` (ex. 8–16 fire paralele → ~4.400 rânduri în < 15–30s). |
