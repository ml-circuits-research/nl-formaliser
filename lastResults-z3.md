# Ultimul benchmark Z3 pe WebMeet

Rulare pereche pe aceleași **1.892 de texte**, WebMeet 1%, seed 42. Am verificat identitatea textului și a identificatorului pentru toate perechile.

| Intrare | Referință | Curent |
| --- | --- | --- |
| Formalizator | `a6ed12b30f14ebfa4cf32ce5340582153c3ea113` | `3b1469da730839a7c874ba281e75cccfe07a87db` |
| Început (CET) | 2026-11-25T21:54:13+01:00 | 2026-11-25T21:54:13+01:00 |
| Sfârșit (CET) | 2026-11-25T22:00:43+01:00 | 2026-11-25T22:07:46+01:00 |

- Date `3d13d9bc6b85675882c99c34c64f93e45dce1f3a`
- Cunoștințe `3b2deebd85aa6ca070b7dc2ce94ff775fc891658`
- Evaluator comun Z3 `dc5e46d0ca2b0751249e02604f966e9e1029d45f`, Node.js 22.23.2 și z3-solver 5.4.1. Maximum opt propuneri pe text, câte zece workeri, cu ortografia și încrederea dezactivate.
- Ambele cititoare au primit exclusiv textul curent, fără tab din dataset, istoric sau ceas. Referința folosește metoda istorică `formalise` cu `tab=null` și clasarea lexicală internă, cu maximum două propuneri pe subcatalog vechi. Revizia curentă folosește `formaliseCurrentText` cu catalogul unificat. Evaluatorul comun a primit circuitele, fără metadatele de tab din propunerile vechi.

| Nivel | Referință | Curent |
| --- | ---: | ---: |
| L0 | 33 (1,7%) | 52 (2,7%) |
| L1 | 1.065 (56,3%) | 1.114 (58,9%) |
| L1a | 108 (5,7%) | 127 (6,7%) |
| L1b | 142 (7,5%) | 304 (16,1%) |
| L1c | 599 (31,7%) | 484 (25,6%) |
| L1d | 216 (11,4%) | 199 (10,5%) |
| L2 | 212 (11,2%) | 199 (10,5%) |
| L2a | 28 (1,5%) | 18 (1,0%) |
| L2b | 113 (6,0%) | 118 (6,2%) |
| L2c | 71 (3,8%) | 63 (3,3%) |
| L3 | 38 (2,0%) | 36 (1,9%) |
| L4 | 544 (28,8%) | 491 (26,0%) |
| L3 + L4 | 582 (30,8%) | 527 (27,9%) |

**46** cazuri au intrat în L3/L4 și **101** au ieșit. Diferența netă este **-55 cazuri (-2,91 puncte procentuale)**.
Pragul operațional de +5 puncte procentuale nu a fost atins. Lucrul de implementare intră în standby până la 26 noiembrie, 08:00 CET, sau până la reluarea explicită de către owner.

Mecanismul ales pentru reluare este legarea rezultatului de ținta scrisă, pe fiecare cerere, folosind familiile compatibile și rolurile declarate. L1b a crescut de la 142 la 304 și apare în 66 dintre cele 101 pierderi de acceptare. În `drawing/scenes-13.csv:2712`, cititorul curent transformă materialul din cererea despre bancă într-o destinație de link. În `drawing/placement-02.csv:1433`, a doua cerere schimbă ținta într-un grup, deși prima a creat o floare. În 13 pierderi L1b, singura diferență semantică semnalată de evaluator este `lookup`. Aceste cazuri se auditează față de regula textului curent, cu păstrarea referințelor literale și fără a adăuga o origine din context.

[Rezultatele pereche pe fiecare rând](eval/results/z3-paired-2026-11-25.json) · [Rezultatul istoric din Q-NL-017](questions.md#measurement--webmeet-1-through-q-nl-017)
