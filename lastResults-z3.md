# Ultimul benchmark Z3 pe WebMeet

**25 noiembrie 2026, 15:29:35 CET (UTC+01:00)** este ora măsurării consemnate în `1ec3400ff6833c29be2057cb809b508d81201f14`. Rezultatul este istoric față de reviziile ulterioare ale formalizatorului. Probele țintite ulterioare nu actualizează acest tabel.

| Intrare | Valoare |
| --- | --- |
| Formalizator Z3 | `a6ed12b30f14ebfa4cf32ce5340582153c3ea113` |
| Date WebMeet | `3d13d9bc6b85675882c99c34c64f93e45dce1f3a` |
| Cunoștințe | `3b2deebd85aa6ca070b7dc2ce94ff775fc891658` |
| Eșantion | WebMeet 1%, seed 42, **1.892 de texte** |
| Evaluator și configurare | `eval/benchmark.mjs`, evaluare Z3, tab-agnostic, maximum 8 propuneri și 2 per tab, 10 workeri, ortografie și încredere dezactivate |

| Nivel | Cazuri | Procent | Semnificație |
| --- | ---: | ---: | --- |
| L0 | 46 | 2,4% | Formalizare inutilizabilă |
| **L1** | **990** | **52,3%** | Sens greșit |
| ↳ L1a | 143 | 7,6% | Intenție greșită |
| ↳ L1b | 96 | 5,1% | Țintă greșită |
| ↳ L1c | 603 | 31,9% | Rol, valoare sau detaliu greșit. 23 de ortografie și 580 din alte cauze |
| ↳ L1d | 148 | 7,8% | Cerere sau detaliu inventat |
| **L2** | **198** | **10,5%** | Sens parțial |
| ↳ L2a | 30 | 1,6% | Cerere omisă |
| ↳ L2b | 75 | 4,0% | Țintă, referință sau punct final incomplet |
| ↳ L2c | 93 | 4,9% | Alt detaliu semantic omis |
| L3 | 39 | 2,1% | Potrivire exactă cu referința |
| L4 | 619 | 32,7% | Alternativă acceptabilă |
| **L3 + L4** | **658** | **34,8%** | **Corecte sau acceptabile** |

Pragul de peste 90% pe acest eșantion cere cel puțin 1.703 cazuri acceptate. La următoarea evaluare agregată, actualizați ora reală a măsurării, reviziile, configurarea și distribuția măsurată.

[Raportul rularii Q-NL-017](questions.md#measurement--webmeet-1-through-q-nl-017) · [Tabelul consemnat în planul L1](L1-Issues-plan.md#1-ultimul-benchmark-webmeet-de-1)
