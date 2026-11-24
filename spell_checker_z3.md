# Propunere: Layer ortografic / Spellchecker în Z3 + Estimare de încredere

> **Statut**: Propunere de arhitectură și analiză de plauzabilitate (neimplementată în cod — doar design & evaluare tehnică).

## 1. Motivație: ce zgomot real există în date

Din analiza eșantionului random de 1% din `webmeet-dataset` (`1.892` cazuri), o clasă distinctă de eșecuri ale formalizatorului Z3 provine strict din **zgomot ortografic intenționat sau natural**, nu din logica formalizatorului:

| Tip de eroare ortografică | Exemplu real din `webmeet-dataset` | Intenție reală | Efect fără Layer 1 |
|---|---|---|---|
| Litere lipsă | `"selct the word \"intro\""` | `select` | `selct` cade în `unread`, se pierde `act=pick` |
| Litere în plus / dublate | `"2024 beeside 2023"` | `beside` | `beeside` cade în `unread`, se pierde relația |
| Transpoziție / inversare | `"copy the atble"`, `"a small rtee"` | `table`, `tree` | obiectul cade în `unread`, `target.sort` lipsește |
| Cuvinte lipite (spațiu lipsă) | `"a drop shadow onte sail onthe boat"` | `on the sail on the boat` | `onte`, `onthe` blochează prepoziția + `part.owner` |
| Spațiu inserat / deplasat în cuvânt | `"the losing months should stando ut, so make theb ars below 7 teal"` | `stand out`, `the bars` | `theb ars` nu e recunoscut ca `bars`/`chart`, `stando ut` e `unread` |

Un spellchecker clasic **token-cu-token** rezolvă doar primele 3 cazuri (și greșește frecvent pe cuvinte scurte), dar **eșuează complet** pe ultimele 2 (`"theb ars"`, `"stando ut"`, `"onte"`, `"onthe"`), deoarece însăși frontiera de spațiu este coruptă.

---

## 2. Arhitectură propusă: Pipeline în 2 straturi separate

Separarea strictă propusă de utilizator (**Layer 1 ortografic** → **Layer 2 formalizator Z3**) este arhitectural superioară amestecării într-un singur model SMT din 3 motive:
1. **Complexitate combinatorică izolată**: Layer 1 lucrează pe caractere și dicționar (spațiu mic, local); Layer 2 lucrează pe semantica `w.request` (clauze, acte, faze, lookup). Amestecate, ar multiplica variabilele Z3 de 5–10×.
2. **Reutilizabilitate și testabilitate independentă**: Layer 1 poate fi testat și măsurat separat pe perechi `(raw_text, clean_text)` pentru orice lume cu orice vocabular.
3. **Păstrarea grounding-ului `w.request` (`check.mjs`)**: Layer 1 nu „rescrie orbește” textul; emite **alinierea exactă pe caractere** între fiecare token curățat și substring-ul brut original, astfel încât Layer 2 să poată emite `sort=table sort_words=atble` sau `family_words="theb ars"` — **100% valid** sub regula `phrase found in the text` din `check.mjs`.

```text
Text brut:  "make theb ars below 7 teal"
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: Normalizator Ortografic pe Vocabularul Lumii (Z3)  │
│  1. Index SymSpell / Delete-Neighborhood pe vocabularul KB  │
│  2. Generare latice pe intervale de caractere [i, j)        │
│     (1-token edit, merge 2-3 segmente, split 1->2 cuvinte,  │
│      re-segmentare spațiu deplasat "theb ars" -> "the|bars")│
│  3. Scut pentru nume proprii, coduri, cifre, citate         │
│  4. Z3 MaxSMT: acoperire exactă [0..N) cu cost minim        │
│     → Top-K ipoteze aliniate + scor ortografic + margine    │
└─────────────────────────────────────────────────────────────┘
                     │
       Clean: "make the bars below 7 teal"
       Align: "the"→[5,8], "bars"→[8,13] ("theb ars")
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: Formalizatorul Z3 (w.request MaxSMT existent)      │
│  Primește tokenii curați + offset-urile brute originale     │
│  Rezolvă top-1 (sau top-K dacă marginea L1 este mică)       │
│  Calculează costul semantic + marginea Top-1 vs Top-2       │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ESTIMATOR DE ÎNCREDERE (Simbolic, calibrat pe dev)          │
│  Combină energia L1, energia L2, marginea Top1-Top2,        │
│  warning-urile check.mjs → confidence ∈ [0, 1] + bandă      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Cum funcționează Layer 1 în Z3 (Segmentare + Corecție simultană)

### 3.1 Vocabularul țintă (100% derivat dinamic din lumea curentă)
Layer 1 nu folosește un dicționar extern uriaș de 200.000 cuvinte care ar introduce coliziuni false, ci **vocabularul exact al lumii încărcate (`kb`)**:
- Cuvinte gramaticale, prepoziții, filler-e, numeral-e, contracții din `w.lang.en` (~400 cuvinte, **prioritate înaltă** pentru split/merge: `on the`, `in the`, `of the`, `to the`, `a`, `the`, `stand out`);
- Verbe și particule din `k.actions` (~600 forme + flexiuni);
- Chei, `keyWords`, valori închise, nume de familii din `w.request/shards/keys.sop` (~1.200 forme per tab);
- Lexicoane de domeniu (`vocab-kinds.json`, culori, forme, părți, unități, genuri, timp) (~4.000–8.000 forme);
- **Vocabular de sesiune / context** (`previous`, nume de obiecte/întâlniri/secțiuni prezente pe pagină, dacă există).

Total per tab: **~5.000–10.000 forme canonice**, indexabile în `< 50 ms` la pornire cu un **index SymSpell** (chei de ștergere de distanță $\le 2$).

### 3.2 Construirea laticei de intervale de caractere
Considerăm șirul de intrare $S$ de lungime $N$, normalizând temporar secvențele de spații și păstrând pozițiile reale:
Pentru fiecare fereastră locală (un token brut, pereche de 2 tokeni adiacenți separate de spațiu, sau sub-split al unui token lung):
1. **Exact match (`KEEP`)**: tokenul există în vocabular → `editCost = 0`.
2. **Scut de entități (`PASS_THROUGH`)**:
   - Numere, coordonate (`260,180`), ore (`15:00`), date (`2026-12-07`), coduri (`n1`, `o2`), texte între ghilimele (`"..."`) → `cost = 0` (nu se corectează niciodată).
   - Cuvinte cu majusculă în mijlocul propoziției (`Sri`, `Kyoto`, `Chop`, `Review`, `Work 4`) → `PASS_THROUGH` cu `cost = 1` (împiedică corectarea numelui propriu `Sri` în `sir` sau `Chop` în `shop`!).
   - Cuvinte necunoscute cu litere mici (posibile substantive/etichete de domeniu noi, ex. `starbucks`, `stadiums`) → `RAW_UNKNOWN` cu `cost = 18` (mai scump decât o corecție clară de distanță 1, dar mai ieftin decât o deformare absurdă de distanță 2–3!).
3. **Editare 1-token (`EDIT_1`, `EDIT_2`)**: căutare Damerau-Levenshtein (inserție, ștergere, substituție, transpoziție adiacentă `atble → table`, `rtee → tree`, `selct → select`, `beeside → beside`). Cost:
   - transpoziție adiacentă / literă dublată: `cost = 6`
   - 1 ștergere/inserție/substituție pe cuvânt $\ge 4$ litere: `cost = 8`
   - distanță 2 pe cuvânt $\ge 5$ litere: `cost = 15`
   - restricție anti-fals-pozitiv: pentru cuvinte foarte scurte ($\le 3$ litere) nu se permite editare liberă decât ca parte dintr-un merge/split!
4. **Split 1 token → 2 cuvinte (`SPLIT`)**: pentru un token necunoscut (ex. `onthe`, `onte`, `inthe`, `makeit`), încercăm toate tăieturile $k \in [1, L-1]$ cu distanță totală $\le 1$:
   - `onthe` → `on` (0) + `the` (0) → `cost = 5` (penalizare doar de spațiu lipsă!)
   - `onte` → `on` (0) + `the` (1 inserție) → `cost = 11`!
5. **Merge 2 tokeni separați de spațiu → 1 cuvânt (`MERGE`)**:
   - `stando ut` → concatenăm fără spațiu (`standout`), sau cu re-tăiere!
   - `bar ch art` → `bar` + `chart`!
6. **Re-segmentare pe fereastră de 2 tokeni adiacenți (`SHIFT_SPACE`)**:
   - Luăm concatenarea $w_1 + w_2$ (ex. `theb` + `ars` = `thebars`, `stando` + `ut` = `standout`) și testăm toate tăieturile $k \in [1, |w_1+w_2|-1]$:
     - `theb ars` → `the` (0) + `bars` (0) cu 1 deplasare de spațiu → **`cost = 5`**!!
     - `stando ut` → `stand` (0) + `out` (0) cu 1 deplasare de spațiu → **`cost = 5`**!!

### 3.3 Formularea declarativă Z3 pentru Layer 1
Fie $C_0, \dots, C_{P-1}$ caracterele non-whitespace (sau segmentele atomice) ale textului și $h_0, \dots, h_{m-1}$ candidații din laticea ortografică:
```smt2
; Fiecare caracter non-spațiu este acoperit de EXACT un candidat ortografic
(assert (forall-char p : (exactly-one { sel_h | p in span(h) })))

; Constrângeri hard anti-corupere:
; - un cuvânt deja exact în vocabular nu este re-segmentat decât dacă vecinul său este OOV (out-of-vocabulary)!
;   (previne distrugerea perechilor valide precum "the bar" sau "in to")

; Obiectiv MaxSMT:
(assert-soft (not sel_h) :weight edit_cost(h))
; Bonus bigram gramatical / domeniu (ex. DET + NOUN, PREP + DET, PHRASAL_VERB "stand out", "bar chart")
(assert-soft (and sel_h1 sel_h2) :weight bigram_bonus(h1, h2))
```
Cu blocking clause pe secvența de cuvinte canonice alese, Z3 poate returna imediat **Top-$K$ variante curate** (`K = 1..3`) și diferența de cost $\Delta_{\text{L1}} = E_{\text{L1}}(\text{sol}_2) - E_{\text{L1}}(\text{sol}_1)$.

### 3.4 Integrarea curată cu grounding-ul `w.request`
Dacă Layer 1 transformă `"theb ars"` în `["the", "bars"]`, tokenul curat `"bars"` poartă metadatele:
- `normText = "bars"` (folosit de `buildLattice` pentru potrivirea pe `kb`),
- `rawSpan = [5, 13]` (`"theb ars"` în textul original).
Astfel, când Layer 2 emite `family_words` sau `sort_words` sau `words`:
- `sort=table sort_words=atble` (exact ca în adnotarea gold din `webmeet-dataset`!)
- `family_words="theb ars"` (exact ca în adnotarea gold!)
- `check.mjs` validează cu **0 erori de grounding**!

---

## 4. Estimarea de încredere (`Confidence Score`) că formalizarea este corectă

Da — **Z3 oferă semnale structurale excepționale** pentru a estima probabilitatea ca o formalizare să fie corectă, fără niciun „ghicit” ad-hoc. În loc de o euristică unică, combinăm **5 semnale ortogonale** extrase direct din execuția Z3 + verifier:

### 4.1 Cele 5 semnale simbolice

| # | Semnal | Formula / Sursa | Semnificație |
|---|---|---|---|
| 1 | **Acoperire semantică (`cov_ratio`)** | $1 - \frac{\#\text{tok}_{\text{unread}} + \#\text{tok}_{\text{uncovered}}}{\max(1, \#\text{tok}_{\text{content}})}$ | Dacă Z3 a fost nevoit să arunce cuvinte de conținut în `w.request.unread` (cost 120/token), formalizarea este incompletă sau greșită. |
| 2 | **Energie MaxSMT normalizată ($E_{\text{norm}}$)** | $\frac{\text{totalSoftPenalty}(\text{sol}_1)}{\max(1, \#\text{tok}_{\text{content}})}$ | Cât de „forțat” a fost modelul optim (cost mic = potriviri exacte pe chei închise + predicate clare + `key_words` legate; cost mare = fallback-uri, open-spans, penalizări de poziție). |
| 3 | **Marginea de ambiguitate Z3 ($\Delta_{\text{sem}}$)** | $E(\text{sol}_2) - E(\text{sol}_1)$ (obținut prin `topK = 2` cu blocking clause pe `(active, act, fam, tmode, constraints)`) | **Semnal critic**: dacă $\Delta_{\text{sem}} \ge 15$, interpretarea este net dominantă; dacă $\Delta_{\text{sem}} \le 3$, există două formalizări aproape la fel de bune (ambiguitate reală!). |
| 4 | **Cost & margine Layer 1 ($\text{edit\_ratio}, \Delta_{\text{L1}}$)** | $\frac{\sum \text{editCost}}{\max(1, N_{\text{chars}})}$ și $E_{\text{L1}}(\text{sol}_2) - E_{\text{L1}}(\text{sol}_1)$ | Dacă textul a necesitat corecții ortografice agresive sau ambigue, încrederea scade proporțional. |
| 5 | **Semnale de verificator & structură (`v_ok`, `v_warn`, `struct_score`)** | `check.mjs`: `errors == 0`, `warnings == 0`, prezența unui predicat explicit (sau fragment nominal clar), absența numelor proprii pierdute, raportul constrângerilor pe chei cu valori închise vs open-span. | Orice eroare de verificator forțează `confidence = 0`. Warning-urile (ex. `single-word unread`) penalizează direct scorul. |

### 4.2 Calibrare și decizie operațională (compatibil cu politica `Review29`)
În loc de praguri inventate manual, cele 5 semnale formează un vector mic $f(x) \in \mathbb{R}^6$ pe care se poate potrivi o **regresie logistică simplă (6 parametri + intercept)** pe `psys2/official-dataset/dev.jsonl` (sau un split de calibrare separat), optimizată pe Brier score / ECE (Expected Calibration Error), pentru a produce o probabilitate reală $p \in [0, 1]$:

- **Încredere RIDICATĂ (`p >= 0.80`)**: `0` unread, `0` warnings, $\Delta_{\text{sem}}$ mare, text curat → execuție directă (cu undo disponibil).
- **Încredere MEDIE (`0.45 <= p < 0.80`)**: mică ambiguitate ($\Delta_{\text{sem}}$ mic) sau corecție ortografică ușoară → execuție pe cea mai plauzibilă variantă + expunerea alternativelor Top-2/Top-3 și a incertitudinii concrete (exact politica *act on most plausible interpretation, state concrete uncertainty, retain alternatives and undo*).
- **Încredere SCĂZUTĂ (`p < 0.45`)**: `unread` prezent, cost ortografic mare sau coliziune între familii → semnalare explicită a porțiunilor neînțelese (`unread`) / propunere de alternative înainte sau alături de acțiune reversibilă.

---

## 5. Estimare realistă de plauzabilitate (Fezabilitate, Latență, Riscuri)

### 5.1 Verdict general: **Foarte plauzibil (8.5 / 10 tehnic)**

| Dimensiune | Estimare realistă | Justificare |
|---|---|---|
| **Efort de implementare Layer 1** | **2–4 zile** (~400–600 linii `.mjs` + ~80 linii SMT-LIB2) | SymSpell pe ~8k cuvinte este banal (~120 linii JS, fără dependențe externe); encoderul Z3 de acoperire pe intervale de caractere este mult mai simplu decât Layer 2. |
| **Latență adăugată (Layer 1)** | **< 2 ms** pe propoziții curate (fast-path: 0 tokeni OOV ⇒ Z3 Layer 1 nici nu se apelează!); **10–50 ms** pe propoziții cu typo-uri | Pe ~85–90% din input-uri toți tokenii sunt cunoscuți (sau nume proprii/cifre), deci costul median este practic **0 ms**. Când există 1–3 tokeni OOV, fereastra locală Z3 are doar 10–30 variabile booleene. |
| **Latență pentru Confidence (`topK=2`)** | **+40–100 ms** median (total p50 ~220–260 ms, p95 ~2.5 s) | O a doua chemare `(check-sat)` pe același context incremental `(push 1)` după adăugarea unei singure clauze de blocare refolosește învățarea internă a Z3 și este de obicei mai rapidă decât prima. |
| **Impact estimat pe acuratețe** | Recuperează **~75–85%** din eșecurile cauzate de typo/split/merge (`"theb ars"`, `"onte"`, `"onthe"`, `"stando ut"`, `"beeside"`, `"atble"`, `"selct"`, `"rtee"`). Pe `webmeet-dataset` total (~5–10% rânduri cu typo-uri), câștig net estimat **+3–6 puncte procentuale** pe `Exact` și **-5–8 pp** pe `Wrong`. | Rezolvă complet clasa de eșecuri ortografice fără a „murdări” gramatica din Layer 2. |
| **Calitatea calibrării Confidence** | **AUROC estimat 0.80–0.88** pentru separarea *corect* vs *greșit* | Deja doar `unread == 0` + `warnings == 0` + `margin > 10` sunt corelate puternic cu `Exact Match` (ex. pe `calendar`: `0-Warn` = 87.5% și `Wrong` = doar 7.5%). |

### 5.2 Riscuri reale și măsuri de prevenire (unde ar putea greși Layer 1)

1. **Supra-corectarea numelor proprii și a substantivelor de domeniu noi (RISCUL #1)**
   - *Exemplu*: `"place Sri above the starbucks block"` — dacă Layer 1 corectează `starbucks` sau `Sri` → dezastru.
   - *Prevenire obligatorie*:
     - Orice token cu majusculă non-inițială (`Sri`, `Kyoto`, `Chop`), citat (`"..."`), cod (`n1`) sau termen după `called`/`named`/`titled`/`labelled` este **protejat hard** (`PASS_THROUGH` cost 0).
     - Un token cu litere mici care apare într-o poziție de open-span (`about <X>`, `of <X>`, `by <X>`, ex. `stadiums`) primește un `RAW_UNKNOWN` cu cost moderat, astfel încât să fie corectat **doar** la distanță 1 foarte clară (ex. `atble` → `table`, `selct` → `select`), nu forțat spre un cuvânt îndepărtat la distanță 2.
2. **Coliziuni pe cuvinte scurte (2–3 litere)**
   - *Exemplu*: `in` / `on` / `at` / `by` / `to` / `no` / `up` sunt toate la distanță 1–2 între ele.
   - *Prevenire*: cuvintele care sunt deja exact în vocabular (inclusiv `in`, `on`, `of`) **nu se modifică niciodată** singure; re-segmentarea (`SHIFT_SPACE` / `MERGE`) se activează **strict** pe ferestre care conțin cel puțin un token OOV (`theb` + `ars`, `stando` + `ut`, `onte`).
3. **Erori semantice invizibile pentru Confidence (fals-pozitiv de încredere)**
   - *Exemplu*: o propoziție curată unde Z3 alege constant o interpretare validă dar greșită (ex. `meeting.room` în loc de `meeting.calendar` dacă ar lipsi regula prepozițională) va avea cost mic și `0` warnings, deci confidence ridicat deși răspunsul e greșit.
   - *Limitare onestă*: estimatorul simbolic de încredere detectează excelent **incertitudinea lexicală, ambiguitatea structurală și lipsa de acoperire** (`unread`, cost ridicat, margine mică), dar nu poate detecta „erorile sistematice” (bias-uri ale axiomelor Z3). Calibrarea pe date reale (`dev.jsonl`) limitează însă plafonul probabilității în funcție de acuratețea empirică pe fiecare tab/familie.
4. **Cuvinte compuse cu greșeli multiple (`"a drop shadow onte sail onthe boat"`)**
   - `onte` → `on the` are **1 spațiu lipsă + 1 literă lipsă (`h`)** (distanță combinată 2). Dacă permitem `SPLIT` cu maximum 1 editare de caracter pe o jumătate atunci când cealaltă jumătate este cuvânt gramatical de înaltă frecvență (`on`, `in`, `to`, `of`, `at`, `the`, `a`), `onte → on the` se rezolvă deterministic cu cost 11!

---

## 6. Concluzie

Separarea în **Layer 1 (Z3 Character-Span Orthographic Normaliser cu fast-path OOV)** + **Layer 2 (Z3 Semantic Formaliser)** + **Confidence Calibration din energia și marginea Top-1/Top-2 Z3** este:
- **100% aliniată cu filozofia declarativă Z3**,
- **rapidă** (cost ~0 ms pe propoziții curate, 10–50 ms pe propoziții cu typo-uri),
- **compatibilă 100% cu verificatorul `check.mjs`** datorită alinierii pe offset-uri brute,
- **direct generalizabilă la lumi noi**, deoarece dicționarul Layer 1 se construiește automat din `kb`-ul lumii active.
