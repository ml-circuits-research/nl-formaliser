# L1-Issues-plan.md — Plan general de reducere a erorilor L1 (`nl-formaliser`)

## 1. Ultimul benchmark WebMeet de 1%

Formaliser `e122ad5`, date WebMeet `3d13d9b`, cunoștințe `3b2deebd`, `N = 1.892`, `seed = 42`, `spellcheck = false`. Evaluarea Z3 alege cea mai bună formalizare completă dintre propuneri.

| Nivel | Cazuri | Procent | Semnificație |
| --- | ---: | ---: | --- |
| L0 | 47 | 2,5% | Formalizare inutilizabilă |
| **L1** | **990** | **52,3%** | Formalizare cu o eroare de sens |
| ↳ L1a | 144 | 7,6% | Intenție greșită |
| ↳ L1b | 89 | 4,7% | Țintă greșită |
| ↳ L1c | 610 | 32,2% | Detaliu, valoare sau rol greșit. 23 cazuri de ortografie și 587 din alte cauze |
| ↳ L1d | 147 | 7,8% | Instrucțiune sau detaliu inventat |
| L2 | 199 | 10,5% | Sens parțial, cu o componentă esențială lipsă |
| L3 | 43 | 2,3% | SOP identic cu referința |
| L4 | 613 | 32,4% | Formalizare alternativă acceptabilă |
| **L3 + L4** | **656** | **34,7%** | **Formalizări corecte sau acceptabile** |

Pragul de peste 90% cere cel puțin 1.703 cazuri la acest eșantion. Prioritatea este atașarea sistematică a rolurilor și a efectelor în L1c. Evaluatorul semnalează și 558 de cazuri cu diferențe atribuite unei adnotări de referință problematice. Aceste semnalări se verifică independent înainte de corectarea datelor.

Principiu de lucru: **zero patch-uri pe propoziții individuale** — toate rezolvările sunt mecanisme generice, conduse de schemele `sop-knowledge-worlds` și formulate declarativ în Z3 MaxSMT.

---

## 2. Plan de atac pe subcategorii L1 (în `nl-formaliser/`)

### P1. Atacarea `L1c (alte cauze)` — `31,0%` (cea mai mare sursă de pierdere)

Progres validat pe circuite complete în Q-NL-010–015. Frame-urile păstrează proprietatea în cererea ei, reperul spațial participă la selectarea obiectului descris, iar măsurile compuse sunt citite ca o singură valoare. Un titlu literal poate traversa un `and` intern și rămâne separat de comanda următoare. Durata unei modificări temporare rămâne în textul `unread` al cererii. Vocabularul canonic distinge ceața, pâcla și vântul și poate furniza ora zilei separat de vreme. Benchmarkul de mai sus acoperă sursa până la Q-NL-014. Elipsa predicatului comun și calificările cu rol propriu rămân de implementat.

1. **Extinderea compilatorului `w.lang.en.frame` → Z3 MaxSMT (`src/lattice/frames.mjs` + `src/smt/encode.mjs` §7b)**
   - **Problema**: Prepozițiile structurale (`on`, `of`, `at`, `with`, `to`, `from`, `by`, `in`) sunt încă deturnate ca relații spațiale (`node.anchor`, `node.position`, `node.relation`, `drawn.at`, `composition.with`) sau endpoint-uri (`link.to`) atunci când propoziția folosește un frame neacoperit sau cu roluri parțiale.
   - **Acțiune**:
     - Compilarea rolurilor suplimentare din `w.lang.en.frame`: `part.owner` (`"the sail on the boat"`, `"the hat of the boy"`), `group.labels`, `series.values`, `page.weather`, `diagram.direction` (`"go left to right"` / `"flow top to bottom"`), `diagram.kind`.
     - Blocarea declarativă în Z3 a deturnărilor `composition.with` / `drawn.at` / `node.anchor` atunci când `with` / `on` / `of` introduce o proprietate, un material, un accesoriu (`drawn.wear`) sau un posesor (`part.owner`).
     - Extinderea `expectedAttrs` pe toate tipurile de frame-uri (proprietăți, etichete, aranjamente, materiale, direcții, diagrame) astfel încât Z3 să lege valoarea exact de atributul cerut de frame.

2. **Dezambiguizarea în Z3 a cheilor cu `key_words` multiplu (`src/smt/encode.mjs`)**
   - **Problema**: Cuvinte precum `label` (8 chei în `diagram`), `name` (6 chei), `width` (4 chei), `size` (3 chei) produc coliziuni frecvente între familii și sub-atribute.
   - **Acțiune**:
     - Preferință soft uniformă în Z3 pentru: (a) potrivire exactă de familie (`attr.family == fam_r`), (b) potrivire exactă de sub-cheie (`attr.shortName == kw.text`), (c) coerență cu verbul/frame-ul activ (`rename`/`label` → `*.label`/`*.name`, `resize`/`widen` → `*.width`/`*.size`).

3. **Atașare locală & `phase` (`selector` vs `result`) în scene multi-obiect**
   - **Problema**: În propoziții lungi cu 3–6 obiecte (`drawing`, `diagram`), atributele (`colour`, `size`, `relation`) pot fi atașate greșit cererii vecine sau cu `phase=result` în loc de `phase=selector`.
   - **Acțiune**:
     - Penalizare progresivă de distanță în Z3 între constrângere și ținta/verbul propriu (`|c.startTok - tpos_r|`), cu barieră pe separatori de clauză (`,`, `and`, `then`, `:`).
     - Regulă declarativă în Z3 pentru modificatori pre-nominali vs post-verbali pe ținte existente (`TM_EXISTING`): modificatorii pre-nominali dintr-o expresie definită (`"the red car"`, `"the small boy"`) primesc prioritate `PH_SELECTOR`, iar predicatul/rezultativul (`"make ... blue"`, `"to 15"`) primește `PH_RESULT`.

4. **Activarea opțională a `L1c (typo / spelling)` — `1.2%`**
   - Deocamdată `--spellcheck` rămâne oprit conform deciziei curente; când va fi activat, Layer-1 Z3 spellchecker (`src/spell/`) atacă direct acest cluster separat, păstrând re-grounding-ul exact pe textul brut.

---

### P2. Atacarea `L1d – Detaliu inventat` — `7,8%`

1. **Reducerea suprasegmentării (`extra_req(2>1)`, `extra_req(3>1)`)**
   - **Problema**: Stage-1 (`src/smt/segment.mjs`) sau solver-ul multi-request sparge uneori o singură cerere cu clauze subordonate/modificatori (`"with each bar labelled, each one a percent of the grand total"`) în 2–3 cereri separate.
   - **Acțiune**:
     - Creșterea pragului de evidență pentru deschiderea unei cereri noi: fără verb nou de acțiune sau separator explicit de cerere, clauzele participiale/prepoziționale (`with ...`, `each ...`, `where ...`) rămân atașate aceleiași cereri.

2. **Eliminarea constrângerilor „parazite” pe cuvinte de context / preambule**
   - **Problema**: Cuvinte conversaționale sau de scenă generează atribute nesusținute (`diagram.background`, `page.scene`, `node.relation`, `drawn.wear`).
   - **Acțiune**:
     - Creșterea costului pentru open-span-uri fără `KEY_WORD` explicit și fără frame activ; preferință pentru `FILLER` pe preambule conversaționale și explicații de motiv (`"before we export, since..."`, `"I think you should..."`).

---

### P3. Atacarea `L1a – Intenție greșită` — `7,6%`

1. **Dezambiguizarea verbelor polisemantice prin structură argumentală**
   - **Problema**: Verbe ca `set` (`change` vs `place`), `make` (`make` vs `change`), `turn` (`change` vs `place`), `open` (`load` vs `change` vs nume propriu `"Open Items"`), `keep` (`change` vs `remove` cu `want=no`), `send`/`save` (confundate în contexte conversaționale).
   - **Acțiune**:
     - Legarea în Z3 a actului de tipul argumentelor prezente în cerere:
       - `set <prop> [on <obj>] to <val>` → `act=change`; `set <obj> <spatial_rel> <anchor>` → `act=place`;
       - `make <indef NP>` → `act=make`; `make <def/pron NP> <adj/prop>` → `act=change`;
       - Capitalizare în titlu/nume propriu (`"Open Items"`) blochează citirea ca verb `PREDICATE` atunci când apare într-o poziție nominală.

2. **Mod interogativ vs imperativ politicos (`mood=ask/check` vs `mood=do`)**
   - **Problema**: Formulări politicoase (`"can you change..."`, `"could you..."`, `"how about a line chart..."`) vs întrebări reale (`"what width does the node have?"`, `"is the house blue?"`).
   - **Acțiune**:
     - Separare clară în Z3 între `frame_lead` politicos (`can you` + verb de acțiune → `mood=do`) și întrebări autentice (`wh`-word + atribut/existență/număr → `act=ask`, `mood=ask`).

---

### P4. Atacarea `L1b – Țintă greșită` — `4,7%`

1. **Dezambiguizarea familiilor `diagram` (`chart` vs `node` vs `diagram` vs `page` vs `link`)**
   - **Problema**: Peste 75% din erorile `L1b` sunt în `diagram`, în special `node/existing vs chart/existing` (ex. `"keep the font a middle size"`, `"turn bars over the target green"`, `"set the colours on Monthly sales to darker"`).
   - **Acțiune**:
     - Introducerea unei legi de propagare a familiei între cererile din aceeași propoziție (dacă cererea 2 menționează `y axis` / `bars` / `chart`, cererea 1 din același context moștenește prioritate pentru `family=chart`).
     - Extinderea vocabularului de indicii de familie din cheile `k.objects` (`bars`, `axis`, `legend`, `series`, `gridlines`, `font`, `palette` → `chart`; `arrow`, `edge`, `connector` → `link`).

2. **Distincția `mode=new` vs `mode=existing` pe referințe implicite**
   - Alinierea strictă în Z3 cu articolul (`a/an` vs `the`/demonstrativ/nume propriu) și cu actul rezultat din structura argumentală.

---

## 3. Propuneri pentru `sop-knowledge-worlds/` (opțional, doar cu acordul tău)

Auditul direct pe `sop-knowledge-worlds` a scos la iveală 4 cauze structurale care alimentează direct `L1b`, `L1c` și `L1d`:

1. **Unificarea cheilor duplicate cu același `means` în același tab**:
   - `drawing`: `drawn.color` / `drawn.colour` (`w.drawing.object.colour`), `part.color` / `part.colour`.
   - `diagram`: 15 grupuri duplicate — cel mai critic fiind `diagram.background` vs `page.background` (ambele cu același `means = w.diagram.diagram.background` și aceleași `keyWords = {background, canvas}`), plus `chart.*` vs `group.*` (`colour`, `label`/`name`, `layout`, `x`, `y`).
   - `document`: 7 grupuri (`block.mark`/`inline.format`/`section.mark`, `document.title`/`text.title`).
   - `calendar`: 6 grupuri (`meeting.duration`/`meeting.length`, `meeting.participants`/`meeting.people`, `room.label`/`room.name`).
2. **Alinierea `mode` între `w.lang.en.frame` și `w.request/schema.sop`**:
   - Cele 501 frame-uri folosesc 57 de `mode`-uri care nu există în cele 9 valori din `w.request/schema.sop` (`what`, `count`, `more`, `less`, `all`, `has`, `calc`, `layout`, `describe` etc.). Definirea clară a unei mapări sau separarea câmpului intern de frame (`frame_kind`) de `request.mode` elimină ambiguitatea.
3. **Curățarea `key_words` în `diagram`**:
   - Eliminarea `width` din `node.size` (lăsându-l pe `node.width`, `chart.width`, `link.width`);
   - Adăugarea `key_words` lipsă pentru `node.name`, `diagram.name`, `link.from`, `link.to`, `diagram.by`.
4. **Completarea frame-urilor lipsă din `w.lang.en.frame`**:
   - Acoperirea formulărilor naturale pentru direcția diagramelor (`"Make the arrows go left to right"`), proprietăți pe grafice/serii și construcții posesive multi-nivel.

---

## 4. Ordine recomandată de execuție și validare

1. **Etapa 1 (Impact maxim — `L1c` + `L1b` în `nl-formaliser/`)**:
   - Extindere `frames.mjs` + `encode.mjs` §7b (anti-hijack pe `composition.with`/`drawn.at`/`part.owner`, roluri `series`/`diagram.direction`/`group.labels`) + dezambiguizare `key_words` și propagare `family=chart` în `diagram`.
   - *Țintă realistă*: reducere `L1c` cu 6–10 pp și `L1b` cu 1.5–2 pp.
2. **Etapa 2 (`L1d` + `L1a` în `nl-formaliser/`)**:
   - Strângerea suprasegmentării în `segment.mjs`, reducerea open-span-urilor parazite și dezambiguizarea `set`/`make`/`open`/`keep` + polite-imperative vs `ask`.
   - *Țintă realistă*: reducere `L1d` cu 2–3 pp și `L1a` cu 2–3 pp.
3. **Etapa 3 (Curățare `sop-knowledge-worlds/` — dacă aprobi)**:
   - Deduplicare `means` + curățare `key_words` + completare frame-uri lipsă.
4. **Protocol de verificare după fiecare etapă**:
   - `npm test` (100% pass, plus teste noi pe fiecare mecanism);
   - Dev audit rapid (`node eval/audit-clusters.mjs --limit 250 --z3-eval --workers 10`, `seed=1337`);
   - Benchmark pe holdout-ul nevăzut 1% (`N = 1.892`, `seed = 42`, `--tab-agnostic --z3-eval --max-proposals 8 --per-tab-topk 2 --workers 10`, `spellcheck = false`), raportat compact în 2 coloane aliniate la stânga, cu `L1c` spart în `typo` vs `alte cauze`.
