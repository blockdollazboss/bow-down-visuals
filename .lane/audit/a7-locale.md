# A7 — Locale Gap Deep Audit (read-only)

- Tree: `~/workspace/bdv-wt-stack28` — branch `stack28/site` @ `0bdfcefa` (verified with `git rev-parse` at audit start).
- Catalogs: `artifacts/bow-down-visuals/src/locales/{en,ar,de,es,fr,hi,it,ja,ko,pt}.json`.
- Method: every catalog flattened to dot-keys exactly as the guard test flattens (nested objects → `a.b.c`; arrays are single leaves). en = **12,832 flattened keys** across **202 top-level namespaces**. Counts below are script-derived from the files at this commit, not sampled estimates — except the legit-vs-real classification in §1.3, which is a classified sample plus a documented heuristic pass over all identicals (§1.4).
- No catalog was edited. This file is the only output.

## 0. Headline findings

- **ar**: 2,086 missing + 1,581 identical-to-en = **3,667 raw gap** (28.6% of en). Auto-classified real-untranslated subset of identicals: 1,351; estimated real work = 3,437 keys (missing + REAL identicals).
- **de**: 2,086 missing + 2,182 identical-to-en = **4,268 raw gap** (33.3% of en). Auto-classified real-untranslated subset of identicals: 1,764; estimated real work = 3,850 keys (missing + REAL identicals).
- **es**: 2,086 missing + 1,802 identical-to-en = **3,888 raw gap** (30.3% of en). Auto-classified real-untranslated subset of identicals: 1,490; estimated real work = 3,576 keys (missing + REAL identicals).
- **fr**: 2,086 missing + 1,916 identical-to-en = **4,002 raw gap** (31.2% of en). Auto-classified real-untranslated subset of identicals: 1,555; estimated real work = 3,641 keys (missing + REAL identicals).
- **hi**: 2,950 missing + 891 identical-to-en = **3,841 raw gap** (29.9% of en). Auto-classified real-untranslated subset of identicals: 663; estimated real work = 3,613 keys (missing + REAL identicals).
- **it**: 2,950 missing + 1,167 identical-to-en = **4,117 raw gap** (32.1% of en). Auto-classified real-untranslated subset of identicals: 850; estimated real work = 3,800 keys (missing + REAL identicals).
- **ja**: 2,950 missing + 787 identical-to-en = **3,737 raw gap** (29.1% of en). Auto-classified real-untranslated subset of identicals: 585; estimated real work = 3,535 keys (missing + REAL identicals).
- **ko**: 2,950 missing + 778 identical-to-en = **3,728 raw gap** (29.1% of en). Auto-classified real-untranslated subset of identicals: 575; estimated real work = 3,525 keys (missing + REAL identicals).
- **pt**: 2,950 missing + 988 identical-to-en = **3,938 raw gap** (30.7% of en). Auto-classified real-untranslated subset of identicals: 715; estimated real work = 3,665 keys (missing + REAL identicals).
- Missing keys fall in exactly **two shared sets**: ar/de/es/fr miss the same 2,086 keys; hi/it/ja/ko/pt miss the same 2,950 keys. The second group's extra 864 missing keys (present in ar/de/es/fr, absent in hi/it/ja/ko/pt) break down by namespace as: `promo-clip` 127, `pricing` 121, `nfcCards` 73, `myProjects` 72, `merch` 62, `memberships` 60, `mixMaster` 57, `privacy` 51, `movies` 48, `mastering` 47, `promote` 42, `myClips` 36, `mediaDetector` 29, `press-public` 15, `nfcCardProfile` 10, `presave` 8, `notFound` 6 — full per-namespace detail in §1.2.
- Guard: required set = **4,284 keys, 100% present and non-empty in all 9 locales** (§2). The entire gap is guard-external by construction: every missing key is outside the required set, and 10,728 of the identicals are also outside it.
- U+FFFD corruption: **only hi** — 18 keys, 45 replacement characters (§3). All other catalogs: 0.
- Plurals: infrastructure is sound for *present* families (0 partial families in any locale); the defect is *absent* families — `mediaDetector.filesSkipped` + `thumbnailTest.filesSkipped` absent in all 9 locales, plus `pricing.*` (2) + `promo-clip.*` (2) absent in hi/it/ja/ko/pt (§4). Separately, 145 en keys carry `{{count}}` with no plural suffixes at all (§4.3).
- Waves: the task brief asked for 2–4 waves of 300–700 keys per locale. That is arithmetically impossible against a 3,667–4,268-key raw gap per locale (4 × 700 = 2,800 maximum). §5 therefore keeps the 300–700 sizing and the commerce-first ordering and delivers 6–7 waves per locale; each wave total is exact (missing + identical, raw).

## 1. Missing + identical, per locale

### 1.1 Totals

| locale | en keys | present | missing | identical to en | raw gap (missing+identical) | extra keys not in en |
|---|---:|---:|---:|---:|---:|---:|
| ar | 12,832 | 10,746 | 2,086 | 1,581 | 3,667 | 105 |
| de | 12,832 | 10,746 | 2,086 | 2,182 | 4,268 | 21 |
| es | 12,832 | 10,746 | 2,086 | 1,802 | 3,888 | 42 |
| fr | 12,832 | 10,746 | 2,086 | 1,916 | 4,002 | 42 |
| hi | 12,832 | 9,882 | 2,950 | 891 | 3,841 | 21 |
| it | 12,832 | 9,882 | 2,950 | 1,167 | 4,117 | 38 |
| ja | 12,832 | 9,882 | 2,950 | 787 | 3,737 | 21 |
| ko | 12,832 | 9,882 | 2,950 | 778 | 3,728 | 21 |
| pt | 12,832 | 9,882 | 2,950 | 988 | 3,938 | 38 |

Extra keys are stale leaves absent from en (all locales carry 21 stale `nav.*` leaves such as `nav.aiThumbnailGenerator`, `nav.creationHub`, `nav.videoForSong`; ar carries 105, es/fr 42, it/pt 38). They are not translation work; they are a separate dead-key cleanup and are excluded from every gap/wave count.
Array leaves: en has 26 array leaves. All locales carry the 18 `home.*`/`wave8.calendar.dayNames` arrays; the 8 `delight.*` (2) + `retentionDelight.*` (6) array leaves are missing in all 9 locales and are inside the missing counts above.

### 1.2 Full table — locale × namespace (M = missing vs en, I = present but identical to en)

| namespace | en | ar M | ar I | de M | de I | es M | es I | fr M | fr I | hi M | hi I | it M | it I | ja M | ja I | ko M | ko I | pt M | pt I |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| academy | 72 | 4 | 1 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 1 | 4 | 2 | 4 | 5 |
| admin | 189 | 0 | 4 | 0 | 9 | 0 | 4 | 0 | 4 | 0 | 4 | 0 | 8 | 0 | 5 | 0 | 4 | 0 | 6 |
| aiAudio | 12 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 |
| analytics | 43 | 0 | 1 | 0 | 3 | 0 | 3 | 0 | 1 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 2 |
| analyticsHub | 148 | 0 | 2 | 0 | 7 | 0 | 1 | 0 | 5 | 0 | 2 | 0 | 8 | 0 | 3 | 0 | 2 | 0 | 1 |
| artistVault | 264 | 10 | 2 | 10 | 12 | 10 | 2 | 10 | 3 | 10 | 2 | 10 | 2 | 10 | 2 | 10 | 2 | 10 | 3 |
| audioCleanup | 43 | 0 | 0 | 0 | 4 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| audioStudio | 31 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 | 30 | 0 |
| audit | 35 | 0 | 4 | 0 | 8 | 0 | 3 | 0 | 3 | 0 | 5 | 0 | 4 | 0 | 4 | 0 | 4 | 0 | 5 |
| auth | 38 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 3 | 0 | 2 | 0 | 2 | 0 | 1 |
| avatarPresenter | 12 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 | 12 | 0 |
| beatMaker | 63 | 2 | 4 | 2 | 19 | 2 | 15 | 2 | 11 | 2 | 17 | 2 | 19 | 2 | 17 | 2 | 4 | 2 | 20 |
| beats | 98 | 1 | 2 | 1 | 10 | 1 | 3 | 1 | 7 | 1 | 8 | 1 | 6 | 1 | 4 | 1 | 4 | 1 | 7 |
| betaAccess | 79 | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 3 |
| bgReplace | 21 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 | 21 | 0 |
| bgStudio | 39 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 |
| brandCalculator | 58 | 1 | 0 | 1 | 8 | 1 | 2 | 1 | 5 | 1 | 0 | 1 | 7 | 1 | 0 | 1 | 0 | 1 | 3 |
| brandDeals | 71 | 7 | 5 | 7 | 16 | 7 | 7 | 7 | 9 | 7 | 5 | 7 | 15 | 7 | 1 | 7 | 5 | 7 | 3 |
| brandingKit | 9 | 1 | 0 | 1 | 5 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| brandingShop | 104 | 1 | 0 | 1 | 8 | 1 | 3 | 1 | 3 | 1 | 3 | 1 | 3 | 1 | 0 | 1 | 0 | 1 | 2 |
| captionStyler | 45 | 0 | 1 | 0 | 7 | 0 | 3 | 0 | 2 | 0 | 6 | 0 | 6 | 0 | 5 | 0 | 1 | 0 | 2 |
| captionSuite | 110 | 0 | 7 | 0 | 8 | 0 | 7 | 0 | 9 | 0 | 7 | 0 | 8 | 0 | 7 | 0 | 7 | 0 | 7 |
| captionTemplates | 28 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 | 28 | 0 |
| carouselMaker | 58 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 | 58 | 0 |
| cartoonStudio | 41 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 |
| catalogImport | 90 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| catalogVault | 10 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 |
| chooseArtist | 19 | 2 | 0 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 0 | 2 | 0 |
| clipMaker | 56 | 1 | 0 | 1 | 5 | 1 | 3 | 1 | 2 | 1 | 1 | 1 | 4 | 1 | 0 | 1 | 0 | 1 | 3 |
| coach | 77 | 23 | 6 | 23 | 14 | 23 | 9 | 23 | 7 | 23 | 9 | 23 | 15 | 23 | 7 | 23 | 7 | 23 | 9 |
| collabs | 73 | 2 | 0 | 2 | 3 | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 5 | 2 | 0 | 2 | 0 | 2 | 0 |
| colorGrade | 36 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 | 36 | 0 |
| command | 51 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| commentReplies | 41 | 0 | 0 | 0 | 4 | 0 | 2 | 0 | 2 | 0 | 3 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 2 |
| common | 40 | 3 | 1 | 3 | 3 | 3 | 3 | 3 | 2 | 3 | 1 | 3 | 3 | 3 | 1 | 3 | 1 | 3 | 3 |
| community | 43 | 2 | 0 | 2 | 5 | 2 | 2 | 2 | 5 | 2 | 1 | 2 | 5 | 2 | 0 | 2 | 1 | 2 | 0 |
| contact | 16 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| content-calendar | 17 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| contentIntelligence | 146 | 0 | 6 | 0 | 9 | 0 | 7 | 0 | 9 | 0 | 6 | 0 | 6 | 0 | 6 | 0 | 6 | 0 | 6 |
| contests | 45 | 2 | 0 | 2 | 2 | 2 | 0 | 2 | 1 | 2 | 0 | 2 | 1 | 2 | 0 | 2 | 0 | 2 | 1 |
| contracts | 30 | 2 | 0 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 0 | 2 | 2 | 2 | 0 | 2 | 0 | 2 | 0 |
| copyright | 50 | 1 | 0 | 1 | 2 | 1 | 0 | 1 | 1 | 1 | 3 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 0 |
| cover-art | 25 | 1 | 2 | 1 | 5 | 1 | 2 | 1 | 5 | 1 | 3 | 1 | 4 | 1 | 2 | 1 | 3 | 1 | 2 |
| create | 25 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 |
| create-simple | 19 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| credit-history | 22 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| cursor-lab | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dashboard | 75 | 0 | 1 | 0 | 8 | 0 | 3 | 0 | 1 | 0 | 1 | 0 | 4 | 0 | 1 | 0 | 1 | 0 | 2 |
| delight | 9 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 |
| deverb | 50 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 |
| discord-bot | 51 | 0 | 4 | 0 | 6 | 0 | 4 | 0 | 5 | 0 | 6 | 0 | 5 | 0 | 4 | 0 | 5 | 0 | 4 |
| distribute | 116 | 0 | 9 | 0 | 22 | 0 | 10 | 0 | 14 | 0 | 9 | 0 | 14 | 0 | 8 | 0 | 11 | 0 | 12 |
| djSets | 40 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| download | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| email-list | 111 | 0 | 3 | 0 | 8 | 0 | 4 | 0 | 6 | 0 | 3 | 0 | 6 | 0 | 4 | 0 | 4 | 0 | 4 |
| extension | 40 | 0 | 2 | 0 | 4 | 0 | 3 | 0 | 4 | 0 | 5 | 0 | 4 | 0 | 2 | 0 | 3 | 0 | 3 |
| features | 13 | 2 | 0 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 0 | 2 | 1 | 2 | 0 | 2 | 0 | 2 | 0 |
| fillerRemover | 50 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 | 50 | 0 |
| fog-lab | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fomoFeed | 22 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 | 22 | 0 |
| gamers | 32 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| generations | 12 | 1 | 0 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 0 |
| goLive | 49 | 0 | 2 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 1 | 0 | 1 |
| guides | 38 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| harmony | 73 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 |
| headshotStudio | 38 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 | 38 | 0 |
| home | 173 | 2 | 1 | 2 | 11 | 2 | 8 | 2 | 7 | 2 | 2 | 2 | 7 | 2 | 3 | 2 | 4 | 2 | 19 |
| hooks | 97 | 30 | 3 | 30 | 9 | 30 | 4 | 30 | 3 | 30 | 3 | 30 | 4 | 30 | 4 | 30 | 4 | 30 | 6 |
| hub | 48 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 1 |
| hubSpine | 131 | 0 | 5 | 0 | 6 | 0 | 6 | 0 | 8 | 0 | 5 | 0 | 6 | 0 | 5 | 0 | 5 | 0 | 6 |
| importPage | 36 | 1 | 3 | 1 | 6 | 1 | 6 | 1 | 3 | 1 | 4 | 1 | 6 | 1 | 3 | 1 | 3 | 1 | 3 |
| interviewPrep | 57 | 0 | 3 | 0 | 8 | 0 | 5 | 0 | 8 | 0 | 3 | 0 | 6 | 0 | 4 | 0 | 3 | 0 | 7 |
| introsOutros | 30 | 0 | 0 | 0 | 6 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 2 |
| invite | 29 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 | 29 | 0 |
| jewelry | 123 | 1 | 1 | 1 | 4 | 1 | 4 | 1 | 5 | 1 | 0 | 1 | 4 | 1 | 0 | 1 | 0 | 1 | 4 |
| jewelryShop | 44 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 |
| labelPitch | 100 | 2 | 0 | 2 | 10 | 2 | 9 | 2 | 13 | 2 | 21 | 2 | 18 | 2 | 0 | 2 | 0 | 2 | 11 |
| language | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| library | 16 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 |
| linkInBio | 83 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 |
| liveGuests | 110 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| liveShopping | 84 | 0 | 2 | 0 | 8 | 0 | 3 | 0 | 6 | 0 | 3 | 0 | 6 | 0 | 1 | 0 | 1 | 0 | 4 |
| llcGuide | 120 | 0 | 2 | 0 | 7 | 0 | 5 | 0 | 4 | 0 | 4 | 0 | 6 | 0 | 1 | 0 | 1 | 0 | 6 |
| locations | 17 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| logoMaker | 42 | 0 | 1 | 0 | 7 | 0 | 3 | 0 | 5 | 0 | 1 | 0 | 8 | 0 | 1 | 0 | 1 | 0 | 2 |
| lrcExport | 47 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 |
| lufs | 53 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 | 53 | 0 |
| lyricVideo | 41 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| makeSong | 76 | 0 | 1 | 0 | 16 | 0 | 10 | 0 | 14 | 0 | 33 | 0 | 16 | 0 | 2 | 0 | 2 | 0 | 11 |
| makeVideo | 218 | 0 | 4 | 0 | 25 | 0 | 15 | 0 | 19 | 0 | 5 | 0 | 20 | 0 | 5 | 0 | 5 | 0 | 15 |
| mashup | 57 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 | 57 | 0 |
| mastering | 47 | 0 | 46 | 0 | 46 | 0 | 46 | 0 | 46 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 | 47 | 0 |
| mediaDetector | 31 | 2 | 29 | 2 | 29 | 2 | 29 | 2 | 29 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 |
| memberships | 66 | 6 | 57 | 6 | 57 | 6 | 57 | 6 | 57 | 66 | 0 | 66 | 0 | 66 | 0 | 66 | 0 | 66 | 0 |
| merch | 64 | 2 | 62 | 2 | 62 | 2 | 62 | 2 | 62 | 64 | 0 | 64 | 0 | 64 | 0 | 64 | 0 | 64 | 0 |
| milestones | 63 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 | 63 | 0 |
| mixMaster | 74 | 17 | 54 | 17 | 54 | 17 | 54 | 17 | 54 | 74 | 0 | 74 | 0 | 74 | 0 | 74 | 0 | 74 | 0 |
| moneyTracker | 56 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 |
| motionGraphics | 43 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 |
| moveHome | 103 | 0 | 6 | 0 | 16 | 0 | 10 | 0 | 10 | 0 | 6 | 0 | 13 | 0 | 6 | 0 | 6 | 0 | 8 |
| movies | 49 | 1 | 48 | 1 | 48 | 1 | 48 | 1 | 48 | 49 | 0 | 49 | 0 | 49 | 0 | 49 | 0 | 49 | 0 |
| myClips | 43 | 7 | 32 | 7 | 32 | 7 | 32 | 7 | 32 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 | 43 | 0 |
| myProjects | 97 | 14 | 72 | 14 | 73 | 14 | 72 | 14 | 72 | 86 | 0 | 86 | 0 | 86 | 0 | 86 | 0 | 86 | 0 |
| myShop | 120 | 0 | 4 | 0 | 7 | 0 | 6 | 0 | 8 | 0 | 5 | 0 | 5 | 0 | 5 | 0 | 5 | 0 | 5 |
| nav | 120 | 0 | 4 | 0 | 24 | 0 | 11 | 0 | 10 | 0 | 6 | 0 | 16 | 0 | 4 | 0 | 4 | 0 | 9 |
| nfcCardProfile | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 |
| nfcCards | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 | 73 | 0 |
| notFound | 6 | 0 | 6 | 0 | 6 | 0 | 6 | 0 | 5 | 6 | 0 | 6 | 0 | 6 | 0 | 6 | 0 | 6 | 0 |
| outOfCredits | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| outreach | 127 | 0 | 7 | 0 | 10 | 0 | 9 | 0 | 9 | 0 | 7 | 0 | 9 | 0 | 7 | 0 | 7 | 0 | 9 |
| paidSeries | 48 | 0 | 1 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 |
| photoEnhance | 33 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 |
| photoShoot | 25 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 |
| planPublic | 15 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 |
| playlist | 38 | 0 | 0 | 0 | 4 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 0 | 1 | 0 | 1 | 0 | 3 |
| playlistPitch | 121 | 0 | 1 | 0 | 8 | 0 | 1 | 0 | 5 | 0 | 1 | 0 | 6 | 0 | 1 | 0 | 1 | 0 | 6 |
| podcast | 147 | 0 | 6 | 0 | 11 | 0 | 8 | 0 | 11 | 0 | 6 | 0 | 9 | 0 | 6 | 0 | 6 | 0 | 7 |
| presave | 47 | 38 | 8 | 38 | 8 | 38 | 8 | 38 | 8 | 46 | 0 | 46 | 0 | 46 | 0 | 46 | 0 | 46 | 0 |
| press-kit | 129 | 0 | 7 | 0 | 15 | 0 | 10 | 0 | 15 | 0 | 7 | 0 | 14 | 0 | 7 | 0 | 8 | 0 | 11 |
| press-public | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 | 15 | 0 |
| pricing | 122 | 0 | 111 | 0 | 115 | 0 | 115 | 0 | 115 | 121 | 0 | 121 | 0 | 121 | 0 | 121 | 0 | 121 | 0 |
| privacy | 51 | 0 | 51 | 0 | 51 | 0 | 51 | 0 | 51 | 51 | 0 | 51 | 0 | 51 | 0 | 51 | 0 | 51 | 0 |
| proFinishing | 35 | 0 | 1 | 0 | 5 | 0 | 1 | 0 | 4 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 1 | 0 | 2 |
| producerTag | 33 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 | 33 | 0 |
| productPhotoStudio | 67 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 | 67 | 0 |
| promo-clip | 128 | 1 | 119 | 1 | 123 | 1 | 123 | 1 | 123 | 128 | 0 | 128 | 0 | 128 | 0 | 128 | 0 | 128 | 0 |
| promote | 44 | 2 | 40 | 2 | 40 | 2 | 39 | 2 | 39 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 |
| qrLogin | 9 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 | 9 | 0 |
| randomizer | 31 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 29 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 |
| referrals | 88 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 | 49 | 39 |
| refundPolicy | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 | 0 | 39 |
| release | 39 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 | 1 | 38 |
| repurpose | 53 | 4 | 48 | 4 | 49 | 4 | 49 | 4 | 49 | 4 | 48 | 4 | 49 | 4 | 48 | 4 | 48 | 4 | 49 |
| retention | 174 | 0 | 2 | 0 | 6 | 0 | 5 | 0 | 5 | 0 | 5 | 0 | 2 | 0 | 5 | 0 | 5 | 0 | 2 |
| retentionDelight | 40 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 |
| retentionDoctor | 55 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 | 55 | 0 |
| review | 76 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 1 | 0 | 2 |
| royalties | 62 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 | 1 | 60 |
| samples | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 | 0 | 44 |
| scheduler | 208 | 76 | 129 | 76 | 129 | 76 | 129 | 76 | 127 | 76 | 129 | 76 | 129 | 76 | 129 | 76 | 129 | 76 | 129 |
| scriptWriter | 75 | 19 | 2 | 19 | 7 | 19 | 9 | 19 | 8 | 19 | 6 | 19 | 11 | 19 | 3 | 19 | 2 | 19 | 8 |
| setlist | 47 | 0 | 1 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 2 |
| settings | 72 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| sfx | 39 | 0 | 1 | 0 | 6 | 0 | 5 | 0 | 5 | 0 | 0 | 0 | 6 | 0 | 1 | 0 | 1 | 0 | 6 |
| share | 16 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| shop | 33 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| shoutouts | 71 | 2 | 2 | 2 | 2 | 2 | 0 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 |
| showcasePublish | 19 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| shows | 55 | 1 | 0 | 1 | 6 | 1 | 3 | 1 | 4 | 1 | 3 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 3 |
| signup | 22 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| singingVoice | 26 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 | 26 | 0 |
| smartClips | 35 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| social-proof | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| socialProof | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| songAndVideo | 187 | 2 | 2 | 2 | 23 | 2 | 13 | 2 | 13 | 2 | 3 | 2 | 17 | 2 | 4 | 2 | 2 | 2 | 13 |
| songRework | 35 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 | 35 | 0 |
| songs | 29 | 6 | 2 | 6 | 6 | 6 | 4 | 6 | 3 | 6 | 2 | 6 | 4 | 6 | 2 | 6 | 2 | 6 | 4 |
| sounds | 50 | 1 | 3 | 1 | 13 | 1 | 4 | 1 | 9 | 1 | 3 | 1 | 10 | 1 | 3 | 1 | 3 | 1 | 5 |
| speedRamp | 32 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 | 32 | 0 |
| splitScreen | 70 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 | 70 | 0 |
| sponsorDashboard | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| sponsorDealDetail | 72 | 1 | 1 | 1 | 3 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 2 |
| sponsors | 32 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| sponsorsPost | 31 | 0 | 2 | 0 | 4 | 0 | 2 | 0 | 5 | 0 | 5 | 0 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| stabilize | 31 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 | 31 | 0 |
| stems | 81 | 21 | 2 | 21 | 6 | 21 | 5 | 21 | 5 | 21 | 3 | 21 | 5 | 21 | 4 | 21 | 2 | 21 | 3 |
| storefrontBuilder | 84 | 0 | 3 | 0 | 6 | 0 | 3 | 0 | 5 | 0 | 5 | 0 | 4 | 0 | 4 | 0 | 4 | 0 | 4 |
| storefronts | 17 | 1 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| streamPack | 33 | 10 | 0 | 10 | 1 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 | 10 | 0 |
| syncPitch | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 | 0 | 117 |
| team | 62 | 0 | 2 | 0 | 5 | 0 | 2 | 0 | 2 | 0 | 3 | 0 | 6 | 0 | 3 | 0 | 3 | 0 | 3 |
| terms | 35 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thumbnail | 69 | 0 | 4 | 0 | 15 | 0 | 6 | 0 | 6 | 0 | 4 | 0 | 10 | 0 | 4 | 0 | 4 | 0 | 7 |
| thumbnailMaker | 60 | 5 | 1 | 5 | 8 | 5 | 3 | 5 | 5 | 5 | 2 | 5 | 4 | 5 | 1 | 5 | 0 | 5 | 4 |
| thumbnailStudio | 8 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 | 7 | 0 |
| thumbnailTest | 42 | 2 | 0 | 2 | 2 | 2 | 0 | 2 | 0 | 2 | 1 | 2 | 2 | 2 | 0 | 2 | 0 | 2 | 1 |
| thumbnails | 25 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 1 |
| tipPage | 18 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 |
| tips | 38 | 1 | 5 | 1 | 5 | 1 | 3 | 1 | 5 | 1 | 5 | 1 | 5 | 1 | 5 | 1 | 5 | 1 | 5 |
| titles | 49 | 1 | 3 | 1 | 8 | 1 | 5 | 1 | 8 | 1 | 4 | 1 | 5 | 1 | 4 | 1 | 4 | 1 | 6 |
| tour | 73 | 1 | 0 | 1 | 7 | 1 | 0 | 1 | 3 | 1 | 4 | 1 | 3 | 1 | 0 | 1 | 0 | 1 | 1 |
| translate | 39 | 0 | 2 | 0 | 3 | 0 | 4 | 0 | 3 | 0 | 2 | 0 | 4 | 0 | 2 | 0 | 2 | 0 | 3 |
| trends | 46 | 0 | 3 | 0 | 11 | 0 | 5 | 0 | 7 | 0 | 3 | 0 | 6 | 0 | 3 | 0 | 3 | 0 | 5 |
| tutorials | 37 | 0 | 1 | 0 | 3 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 1 |
| upscale | 81 | 14 | 2 | 14 | 4 | 14 | 3 | 14 | 3 | 14 | 0 | 14 | 4 | 14 | 2 | 14 | 0 | 14 | 2 |
| videoEditor | 719 | 0 | 7 | 0 | 61 | 0 | 26 | 0 | 33 | 0 | 9 | 0 | 41 | 0 | 9 | 0 | 13 | 0 | 18 |
| videoExport | 220 | 0 | 3 | 0 | 8 | 0 | 15 | 0 | 11 | 0 | 4 | 0 | 13 | 0 | 4 | 0 | 4 | 0 | 8 |
| videoTemplates | 56 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 | 56 | 0 |
| videoTemplatesPage | 28 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 | 27 | 0 |
| viralityCheck | 43 | 0 | 6 | 0 | 12 | 0 | 6 | 0 | 6 | 0 | 6 | 0 | 7 | 0 | 6 | 0 | 6 | 0 | 8 |
| vocalPolish | 41 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 | 41 | 0 |
| vocalRemoval | 35 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| vocalTune | 40 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 | 40 | 0 |
| voiceover | 35 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 3 | 0 | 1 | 0 | 5 | 0 | 1 | 0 | 1 | 0 | 1 |
| waitlist | 75 | 2 | 0 | 2 | 9 | 2 | 1 | 2 | 3 | 2 | 0 | 2 | 4 | 2 | 0 | 2 | 0 | 2 | 3 |
| wallpapers | 103 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 1 |
| watermarkRemoval | 43 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| wave8 | 294 | 0 | 1 | 0 | 13 | 0 | 9 | 0 | 15 | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 10 |
| wave9 | 282 | 0 | 2 | 0 | 15 | 0 | 5 | 0 | 8 | 0 | 2 | 0 | 7 | 0 | 3 | 0 | 3 | 0 | 5 |
| websiteBuilder | 86 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 1 | 0 | 1 |
| weekly_contest | 25 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 | 25 | 0 |
| world | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **12832** | **2086** | **1581** | **2086** | **2182** | **2086** | **1802** | **2086** | **1916** | **2950** | **891** | **2950** | **1167** | **2950** | **787** | **2950** | **778** | **2950** | **988** |

### 1.3 Sample classification — 30 identical values per locale (stratified: every ⌊N/30⌋-th identical, keys sorted)

Classes: **LEGIT** = correctly identical (brand/house name, platform/proper noun, URL/e-mail/example identifier, number/format/abbreviation only, or a true cognate/established loanword in that language). **BORDERLINE** = house product name or loanword a translator must confirm keep-vs-translate; counted as work until ruled. **REAL** = untranslated English.

#### ar — sample: LEGIT 3/30 · BORDERLINE 0/30 · REAL 27/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.hoursPlaceholder` | 5 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `discord-bot.discord_bot_shared_secret` | DISCORD_BOT_SHARED_SECRET | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `mastering.downloadWav` | WAV (24-bit) | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `mediaDetector.errorDetectionFailedShort` | Detection failed. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 5 | `memberships.pastDue` | Past due | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 6 | `merch.productLabel` | Product | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 7 | `mixMaster.genres.rock.blurb` | Gritty guitars, drums up front. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 8 | `movies.errorDetection` | Detection failed. Try again. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `myClips.noClipsHint` | Generated scene clips auto-save here. Generate your first clip from the Scene Studio. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 10 | `myProjects.previewClip` | Preview Clip | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `nfcCards.bioPlaceholder` | Short bio | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `nfcCards.reviewShipTo` | Ship to | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `press-public.backHome` | Back to home | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `pricing.faq.title` | Frequently Asked Questions | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 15 | `pricing.plans.shotCaller.bestFor` | Teams & creator brands | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `privacy.section4Item2Body` | database and authentication | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `promo-clip.form.songTitle` | Song Title | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `promo-clip.promoTypes.bestBarClip.desc` | Showcase your hardest bar | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `promote.form.focusPlaceholder` | e.g. the 1-Visual Buc price, how fast it is, perfect for new artists… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `referrals.hero.p2` | , and you earn up to | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `refundPolicy.pageTitle` | Refund Policy | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `release.types.album.label` | Album | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `repurpose.titleSuffix` | content calendar out | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `royalties.signIn` | Sign in to track your royalties. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `samples.title` | Sample Pack Generator | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `scheduler.days.wed` | Wed | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `scheduler.tabs.posted` | Posted | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.amountPlaceholder` | $ amount | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `syncPitch.no` | No | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 30 | `syncPitch.typeAd` | Ad | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |

#### de — sample: LEGIT 8/30 · BORDERLINE 2/30 · REAL 20/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.coachRole` | Coach | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `beats.tierBasicLabel` | Basic | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 3 | `clipMaker.vibeWholesomeLabel` | Wholesome | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 4 | `distribute.hip_hop_trap` | Hip-Hop / Trap | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `importPage.format` | Format | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 6 | `makeSong.priceBadge` | 400 Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 7 | `mediaDetector.analyze` | Analyze · {{cost}} Visual Bucs | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 8 | `memberships.signInPrompt` | Sign in to build your fan club. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `merch.unlist` | Unlist | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 10 | `movies.arcLabel` | Arc | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `myClips.ready` | Ready | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `myProjects.typeThumbnailPrompt` | Thumbnail Prompt | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `nfcCards.fullNamePlaceholder` | Full name * | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `playlistPitch.packetLinks` | Links | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 15 | `pricing.creditPacks.processing` | Processing… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `pricing.plans.shotCaller.cta` | Become a Shot Caller | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `privacy.section9Title` | 9. Changes to This Policy | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `promo-clip.moods.emotional` | Emotional | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 19 | `promote.form.angle` | Angle to emphasize | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `referrals.rank.notRanked` | Not ranked yet | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `release.optional` | (optional) | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 22 | `retention.drops.gaming-video-thumbnail.title` | Rage-Click Gaming | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `samples.creditsLeft` | {{num}} Visual Bucs left | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `scheduler.composer.scheduleDraft` | Schedule draft | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `scheduler.toast.bestTimeFailed` | Best-time failed | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `songAndVideo.summaryVideo` | Video | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 27 | `syncPitch.fromLibrary` | From library ({{count}}) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.supervisorEmail` | Music supervisor pitch email | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `trends.nicheBeautyFashion` | Beauty & Fashion | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 30 | `videoEditor.timelineTitle` | Timeline | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |

#### es — sample: LEGIT 8/30 · BORDERLINE 1/30 · REAL 21/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.coachRole` | Coach | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `clipMaker.secondsLabel` | {{n}}s | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `home.demo.pop.label` | Pop | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `makeSong.genreHipHop` | Hip Hop | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `mastering.signInToMaster` | Sign in to master | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 6 | `memberships.errorDuplicateMember` | That fan is already on this tier. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 7 | `merch.noDesignsDetail` | Generate a batch in the Design Studio, then save your favorites here. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 8 | `mixMaster.honestFraming` | A real DSP pipeline — per-stem gain staging, EQ, compression, genre panning, then a full mastering chain with true-peak limiting. It | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `movies.formats.movie` | Movie | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 10 | `myProjects.analysisFailed` | Analysis failed | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `myProjects.typePromoClip` | Promo Clip | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `nfcCards.faq4q` | How long until I get my card? | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `outreach.creatorNamePlaceholder` | King Shark | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 14 | `pricing.creditPacks.networkError` | Network error. Please try again. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 15 | `pricing.plans.gangster.name` | Gangster | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 16 | `privacy.section2Item4Body` | info you enter to personalize AI outputs (artist name, genre, style preferences) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `promo-clip.form.hookRequired` | Required — paste your hook or best bar | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `promo-clip.platforms.tiktok` | TikTok | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 19 | `promote.form.tone` | Tone | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `referrals.link.copy` | Copy | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `refundPolicy.whenWeRefund.title` | When We Do Issue Refunds | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `repurpose.error.repurposeFailed` | Repurposing failed — try again. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `royalties.payouts.periodEnd` | Period end | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `samples.honesty.ai` | AI-composed | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `scheduler.composer.uploadNote` | MP4 / MOV · up to 80 MB · free to upload | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `scheduler.status.scheduled` | Scheduled | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `songAndVideo.genreRB` | R&B | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 28 | `syncPitch.handoffStemsDesc` | Strip or separate your track in Stems | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `syncPitch.stemsAvailable` | Stems available | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 30 | `videoEditor.mask.creditLine` | Made with Bow Down Visuals | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |

#### fr — sample: LEGIT 10/30 · BORDERLINE 1/30 · REAL 19/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.coachRole` | Coach | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `captionSuite.credits` | Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `distribute.genre_2` | Genre: | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `jewelry.format` | Format | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `makeVideo.unknownStep` | ? | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 6 | `mediaDetector.pointsToAi` | points to AI | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 7 | `memberships.tierNamePlaceholder` | Tier name (e.g. Gold Circle) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 8 | `merch.title` | Merch Designer | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `moveHome.locationPh` | Atlanta | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 10 | `myClips.done` | Done | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `myProjects.recover` | Recover | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `nfcCards.cityPlaceholder` | City * | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `nfcCards.viewDigitalCard` | View your digital card | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `press-public.photoAlt` | {{name}} photo {{index}} | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 15 | `pricing.plans.crimeBoss.features.f1` | Everything in Shot Caller | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `privacy.section10Intro` | Privacy questions? Email | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `promo-clip.clipsSelector.available` | {{count}} available | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `promo-clip.noProjects` | No saved projects found. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `promote.form.feature` | Feature to promote | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `referrals.link.title` | Your referral link | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `release.building` | Building your battle plan… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `repurpose.platforms.noDesc` | No description generated for this platform. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `royalties.payouts.statusReceived` | Received | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `samples.tempo` | Tempo | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 25 | `scheduler.error.videoOnly` | Please choose a video file — the auto-post pipelines publish video. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `scheduler.toast.scheduledCost` | Scheduled · 100 Visual Bucs | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `sponsorsPost.descriptionLabel` | Description | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 28 | `syncPitch.newSheetFromBrief` | New sheet | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `team.roleAdmin` | Admin | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 30 | `videoEditor.stockLibrary.priceBadge` | 50 VB / import | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |

#### hi — sample: LEGIT 7/30 · BORDERLINE 2/30 · REAL 21/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.heroTitleAccent` | Playbook | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 2 | `beatMaker.trackClosedHat` | Closed Hat | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 3 | `captionSuite.credits` | Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `copyright.e_g_2026` | e.g. 2026 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `extension.load_unpacked` | Load unpacked | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 6 | `labelPitch.genres.country` | country | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 7 | `makeSong.genreDancehall` | Dancehall | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 8 | `makeVideo.priceBadge` | 200 Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 9 | `podcast.result.apple` | Apple Podcasts Connect | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 10 | `randomizer.crossLink.p1` | Like an idea? Ask | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `referrals.rank.firstStar` | Your first referral earns your first star | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `refundPolicy.howTo.include` | Include: date of charge, amount, and a brief description of the issue | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `refundPolicy.whenWeRefund.unauthorized.title` | Unauthorized charge: | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `release.tools.playlist-pitcher` | Open Playlist Pitcher | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 15 | `repurpose.error.rerollFailed` | Re-roll failed — try again. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `retention.dailyDrop.title` | Thy Daily Drop | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 17 | `royalties.payouts.received` | Received | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `royalties.totals.earnings` | Total earnings | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `samples.honesty.p1` | Drums and FX are | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `scheduler.calendar.prevMonth` | Previous month | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `scheduler.composer.uploading` | Uploading… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `scheduler.niches.music` | Music | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `scheduler.status.scheduled` | Scheduled | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `scriptWriter.bRollLabel` | B-roll: | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 25 | `sponsorsPost.nichePlaceholder` | e.g. Music, Gaming, Fitness | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `syncPitch.deadlineLabel` | due {{date}} | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `syncPitch.myOneSheets` | My One-Sheets | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.savePitch` | Save pitch | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `syncPitch.typeTv` | TV | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 30 | `translate.creditsLabel` | Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |

#### it — sample: LEGIT 11/30 · BORDERLINE 4/30 · REAL 15/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.coachRole` | Coach | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `beatMaker.presetAfrobeats` | Afrobeats | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `brandDeals.niches.lifestyle` | Lifestyle | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 4 | `coach.platformYouTubeBlurb` | Partner Program | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 5 | `dashboard.tile_video` | Video | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 6 | `guides.academy.name` | Creator Academy | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 7 | `jewelryShop.emailPh` | Email * | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 8 | `logoMaker.taglineLabel` | Tagline | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 9 | `moveHome.bioLabel` | Bio | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 10 | `outreach.invoice.brandEmailPlaceholder` | billing@brand.com | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 11 | `proFinishing.codecLabel` | Codec | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 12 | `referrals.hero.reward` | {{num}} free Visual Bucs | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `refundPolicy.howTo.include` | Include: date of charge, amount, and a brief description of the issue | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `release.crossLinks.scheduler` | Content Scheduler | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 15 | `repurpose.copied` | Copied | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `repurpose.titleSuffix` | content calendar out | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `royalties.payouts.status.received` | received | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `samples.generate` | Generate pack · {{cost}} Visual Bucs | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `scheduler.calendar.hint` | Click a future day to schedule · drag a post to another day to move it · click a post to edit or cancel. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `scheduler.days.sat` | Sat | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `scheduler.posted.updatedAt` | Updated {{datetime}} | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `scheduler.toast.refunded` | {{num}} credit{{s}} refunded. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `songAndVideo.costBadge` | 400 Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 24 | `sponsorsPost.budgetMinLabel` | Budget min ($) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `syncPitch.generateSheet` | Generate Sync One-Sheet · {{cost}} VB | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `syncPitch.placedCount` | placed | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `syncPitch.trackThisPitch` | Track this pitch | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `titles.platformInstagram` | Instagram | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 29 | `videoEditor.pageTitle` | Visual Vibes | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 30 | `viralityCheck.hashtagsPlaceholder` | #newmusic #independentartist … | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |

#### ja — sample: LEGIT 7/30 · BORDERLINE 1/30 · REAL 22/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.hoursPlaceholder` | 5 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `beatMaker.track808` | 808 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `coach.cadencePlaceholder` | 3 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `distribute.tier.ep.label` | EP | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `importPage.urlPlaceholder` | https://www.youtube.com/watch?v=… | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 6 | `nav.bowRace` | Bow Race | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 7 | `press-kit.pressRelease.placeholders.contactPhone` | 555-0100 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 8 | `randomizer.titlePrefix` | Content | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `referrals.share.title` | Share it | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 10 | `refundPolicy.howTo.response` | We aim to respond within 2 business days. Approved refunds are returned to your original payment method within 5–10 business days depending on your bank. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `refundPolicy.whenWeRefund.unauthorized.desc` |  You believe your account was accessed without your authorization. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `release.titlePrefix` | Release | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `repurpose.costNote` | {{pack}} Visual Bucs covers everything: transcription, AI analysis, 3 auto-cut clips, 3 AI thumbnails. Re-rolls are {{reroll}} Visual Buc each. Copying and down | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `repurpose.step1.urlPlaceholder` | https://… (from your project storage) | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 15 | `royalties.import.success` | Imported {{num}} entries. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `royalties.payouts.statusReceived` | Received | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `samples.buildTitle` | Build your pack | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `samples.key` | Key | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `scheduler.calendar.today` | Today | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `scheduler.composer.unschedule` | Unschedule → move back to drafts (refunds 100 Visual Bucs) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `scheduler.niches.beauty` | Beauty | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `scheduler.queue.emptyHint` | Schedule a post and it will wait here until it fires — no tab required. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `scheduler.toast.futureDate` | Pick a date in the future. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `songs.sourceCover` | Cover | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `syncPitch.briefsIntro` | Create briefs for the placements you want — TV, film, ads, games — then match your catalog songs against them. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `syncPitch.hideMatches` | Hide | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `syncPitch.notesPlaceholder` | Notes… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.statStems` | Stems | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `syncPitch.writingSheet` | Writing your one-sheet… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 30 | `upscale.afterLabel` | After | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |

#### ko — sample: LEGIT 8/30 · BORDERLINE 0/30 · REAL 22/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.hoursPlaceholder` | 5 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `brandDeals.audiences.k10_50k` | 10K – 50K | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `contentIntelligence.platformTikTok` | TikTok | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `email-list.join_2` | /join/ | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 5 | `liveShopping.crossLinkEnd` | . | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 6 | `outreach.audiencePlaceholder` | 50K | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 7 | `randomizer.categories.challenges.blurb` | Forcing functions for output and growth. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 8 | `referrals.error.loadFailed` | Couldn't load referrals. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 9 | `referrals.signup.suffix` | to get your referral link. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 10 | `refundPolicy.howTo.subject1` | Subject:  | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `release.badge` | Thy Cheat Code's release tools | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `release.tools.content-scheduler` | Open Content Scheduler | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `repurpose.error.clipCuttingFailed` | Clip cutting failed. Your pack Visual Bucs cover the text outputs — clips can be re-cut from the video editor. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `repurpose.thumbs.alt` | Thumbnail concept {{n}} | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 15 | `royalties.import.title` | Import distributor CSV | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `royalties.payouts.title` | Payout tracking | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `samples.buildTitle` | Build your pack | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `samples.key` | Key | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 19 | `scheduler.calendar.prevMonth` | Previous month | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `scheduler.composer.timezoneNote` | Times are in your timezone ({{tz}}). The server fires the post even with this tab closed. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `scheduler.newPost` | New scheduled post | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 22 | `scheduler.queue.editTitle` | Edit / reschedule | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `scheduler.toast.draftSaved` | Draft saved | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 24 | `sounds.platformReels` | Reels | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 25 | `syncPitch.comparableArtists` | Comparable artists | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `syncPitch.keyPlaceholder` | Key (e.g. A minor) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `syncPitch.pickSong` | Pick a song from your library… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.statusPending` | Pending | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `syncPitch.yourSong` | Your song | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 30 | `videoEditor.motionTrack.costChip` | Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |

#### pt — sample: LEGIT 12/30 · BORDERLINE 2/30 · REAL 16/30

| # | key | identical value | class | basis |
|---:|---|---|---|---|
| 1 | `academy.coachRole` | Coach | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 2 | `beatMaker.presetDrill` | Drill | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 3 | `captionSuite.credits` | Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 4 | `dashboard.tile_hook` | Hook | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 5 | `home.demo.hiphop.treatment` | ["OPEN — city rooftop at golden hour, slow push-in on the artist.", "HOOK — drone orbit over the skyline, lights moving in perfect sync."] | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 6 | `interviewPrep.audienceSizePh` | 250K | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 7 | `llcGuide.statEin` | EIN (IRS) | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 8 | `moveHome.locationPh` | Atlanta | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 9 | `playlistPitch.heroBadge` | Playlist Pitcher | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 10 | `randomizer.categories.thumbnails.blurb` | High-click-through concepts for YouTube and beyond. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 11 | `referrals.link.copy` | Copy | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 12 | `refundPolicy.howTo.intro1` | To request a refund, contact us within  | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 13 | `release.costNote` | {{cost}} Visual Bucs per AI plan · checking off tasks is free · powered by Thy Cheat Code | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 14 | `release.types.single.label` | Single | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 15 | `repurpose.repurposeButton` | Repurpose my video · {{credits}} Visual Bucs | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 16 | `royalties.import.desc` | We auto-detect common distributor columns (song, platform, period, streams, amount). Accepts MM/DD/YYYY or YYYY-MM-DD dates. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 17 | `royalties.platforms.connect` | Connect | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 18 | `samples.genres.drum-and-bass` | Drum & Bass | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 19 | `scheduler.bestTime.useSlot` | Use this slot | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 20 | `scheduler.composer.unschedule` | Unschedule → move back to drafts (refunds 100 Visual Bucs) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 21 | `scheduler.niches.tech` | Tech | BORDERLINE | house product name / established loanword — translator confirms keep-vs-translate |
| 22 | `scheduler.tabs.queue` | Queue ({{num}}) | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 23 | `setlist.durationPlaceholder` | 3:30 | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 24 | `sounds.hookWindowLabel` | Use: | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 25 | `syncPitch.contactNamePlaceholder` | Contact name | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 26 | `syncPitch.moneyLogFailed` | Couldn't log the income. Try again. | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 27 | `syncPitch.shareSheet` | Share | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 28 | `syncPitch.writingSheet` | Writing your one-sheet… | REAL | English prose/label; no brand/URL/number/proper-noun/cognate class applies |
| 29 | `translate.perMinuteCost` | × 500 Visual Bucs | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |
| 30 | `videoExport.fCodec` | Codec | LEGIT | legit-identical class (brand/proper/URL/number/format/cognate — see §1.4 rules) |

**Sample total (270 values): LEGIT 74 (27.4%) · BORDERLINE 13 (4.8%) · REAL 183 (67.8%).** The identical-to-en population is therefore mostly real untranslated English, not legit-identical residue — worst in the non-Latin catalogs (ar sample 27/30 REAL, ja 22/30, ko 22/30), least in pt (16/30 REAL, helped by true cognates).

### 1.4 Heuristic classification of ALL identicals (documented rules, estimate)

Rules, applied in order: (1) no Latin letter (number/punctuation/placeholder-only) → LEGIT; (2) bare e-mail example → LEGIT; (3) URL/path literal → LEGIT; (4) ALL-CAPS code identifier (e.g. `DISCORD_CLIENT_ID`) → LEGIT; (5) after stripping `{{…}}` placeholders, house-brand phrases (Bow Down Visuals / Visual Bucs / Visual Vibes / Thy Cheat Code / Bow Down Records / Thy War Room / Thy Receipts / Hook Studio / Playlist Pitcher / King Shark / Creator Academy …), platform names, universal abbreviations (BPM, ISRC, FAQ, EP, DM, PDF, WAV…) and genre names, nothing remains → LEGIT; (6) remaining tokens all in a per-locale cognate/loanword lexicon (de/es/fr/it/pt only, ≤2 tokens) → LEGIT; (7) placeholder key whose value is a short proper-noun example (e.g. `Midnight Run`) → LEGIT; (8) everything else, including all identical arrays → REAL. This heuristic is conservative for Latin locales (multi-word cognates are scored REAL) and generous on class (5); treat REAL as ±5%.

| locale | identical | auto-LEGIT | auto-REAL | sample REAL rate |
|---|---:|---:|---:|---:|
| ar | 1,581 | 230 | 1,351 | 90% |
| de | 2,182 | 418 | 1,764 | 67% |
| es | 1,802 | 312 | 1,490 | 70% |
| fr | 1,916 | 361 | 1,555 | 63% |
| hi | 891 | 228 | 663 | 70% |
| it | 1,167 | 317 | 850 | 50% |
| ja | 787 | 202 | 585 | 73% |
| ko | 778 | 203 | 575 | 73% |
| pt | 988 | 273 | 715 | 53% |

Auto-LEGIT breakdown by class is reproducible with the rules above; the dominant LEGIT class in every locale is brand/platform/abbreviation/number-only (123–186 per locale), followed by no-letter values (20–28) and proper-noun placeholder examples (22–35).

## 2. The locale guard — exactly what it requires

File: `artifacts/bow-down-visuals/src/lib/locale-newest-surfaces.test.ts` (the "wave-3/4 newest surfaces" suite). The required set is **derived from en.json at runtime**, not a literal list:

1. **Whole namespaces (35)** — every en key under: `tutorials`, `command`, `djSets`, `smartClips`, `socialProof`, `playlistPitch`, `liveGuests`, `moveHome`, `catalogImport`, `playlist`, `paidSeries`, `proFinishing`, `videoExport`, `outOfCredits`, `showcasePublish`, `share`, `review`, `videoEditor`, `settings`, `dashboard`, `myShop`, `nav`, `retention`, `wave8`, `wave9`, `podcast`, `outreach`, `press-kit`, `admin`, `analyticsHub`, `contentIntelligence`, `hubSpine`, `captionSuite`, `world`, `wallpapers`.
2. **Block prefixes (3)** — every en key under: `artistVault.identity`, `beats.template`, `myShop.discount` (`artistVault.identity` = 36, `beats.template` = 25, `myShop.discount` = 18 keys; the `myShop.discount` keys are also inside the whole-`myShop` pin, so the whole-namespace count for `myShop` below is 102 non-discount + 18 discount = 120).
3. **The wave-3 e-mail block (53 keys)** — `email-list.` + each of: `tags`, `add_tag`, `tag_name_placeholder`, `segments`, `segment_name_placeholder`, `create_segment`, `manual_tags_all`, `automatic_tags_all`, `sources_any`, `engagement_label`, `eng_any`, `eng_opened`, `eng_clicked`, `eng_engaged`, `eng_none`, `at_presave`, `at_member`, `at_buyer`, `at_opened`, `at_clicked`, `at_engaged`, `members_word`, `segments_suppression_note`, `send_a_campaign`, `audience`, `whole_list`, `use_ai_draft`, `send_campaign_btn`, `campaign_history`, `automations`, `automations_intro`, `automations_loading`, `automation_on`, `automation_off`, `automation_off_note`, `automation_save`, `automation_saved`, `automations_delay_label`, `automations_last_checked`, `automations_never_checked`, `automations_sent_word`, `automations_skipped_word`, `automations_no_provider_word`, `no_campaigns_yet`, `delivered_word`, `opens_word`, `clicks_word`, `opens_total`, `clicks_total`, `save_tags`, `campaign_sent_msg`, `campaign_failed_msg`, `tag_subscribers_hint`.
4. **Singles (9)** — `academy.tabTutorials`, `stems.midi`, `stems.midiTitle`, `stems.errorMidi`, `repurpose.modeSmart`, `myProjects.failedOpenHubProject`, `presave.tracklistTitle`, `beats.customLicensesHeading`, `beats.retry`.

Required keys per component (derived from en at this commit):

| component | keys |
|---|---:|
| `PREFIX artistVault.identity` | 36 |
| `PREFIX beats.template` | 25 |
| `PREFIX myShop.discount` | 18 |
| `SINGLES` | 9 |
| `admin` | 189 |
| `analyticsHub` | 148 |
| `captionSuite` | 110 |
| `catalogImport` | 90 |
| `command` | 51 |
| `contentIntelligence` | 146 |
| `dashboard` | 75 |
| `djSets` | 40 |
| `email-list BLOCK` | 53 |
| `hubSpine` | 131 |
| `liveGuests` | 110 |
| `moveHome` | 103 |
| `myShop` | 102 |
| `nav` | 120 |
| `outOfCredits` | 10 |
| `outreach` | 127 |
| `paidSeries` | 48 |
| `playlist` | 38 |
| `playlistPitch` | 121 |
| `podcast` | 147 |
| `press-kit` | 129 |
| `proFinishing` | 35 |
| `retention` | 174 |
| `review` | 76 |
| `settings` | 72 |
| `share` | 16 |
| `showcasePublish` | 19 |
| `smartClips` | 35 |
| `socialProof` | 17 |
| `tutorials` | 37 |
| `videoEditor` | 719 |
| `videoExport` | 220 |
| `wallpapers` | 103 |
| `wave8` | 294 |
| `wave9` | 282 |
| `world` | 9 |
| **TOTAL REQUIRED** | **4284** |

What the guard actually checks on that set, per locale: key present, value non-empty (sole exception: `socialProof.headlinePrefix` may be empty in ja/ko), and `{{…}}` placeholder shape identical to en. Value-level difference-from-en (residue) is additionally pinned **only** for 8 namespaces — `playlistPitch`, `outreach`, `press-kit`, `admin`, `analyticsHub`, `contentIntelligence`, `hubSpine`, `captionSuite` — each with an explicit legit-identical allowlist in the same file. Identical values in the other 28 pinned namespaces pass the guard.

### 2.1 Verification — guard-required set is 100% present in all locales

| locale | required | present | missing | empty values | placeholder-shape failures* |
|---|---:|---:|---:|---:|---|
| ar | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| de | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| es | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| fr | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| hi | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| it | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| ja | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| ko | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |
| pt | 4,284 | 4,284 | 0 | 0 | not re-run (guard suite's own assertion; presence/emptiness recomputed here) |

**Confirmed: the guard-required set (4,284 keys) is 100% present and non-empty in all 9 locales.** The gap is therefore exactly the guard-external set: 8,548 en keys. Per locale, guard-external missing / identical:

| locale | guard-external en keys | missing (all guard-external) | identical, guard-external | identical, inside guard set (mostly legit + residue-pinned namespaces) |
|---|---:|---:|---:|---:|
| ar | 8,548 | 2,086 | 1,497 | 84 |
| de | 8,548 | 2,086 | 1,903 | 279 |
| es | 8,548 | 2,086 | 1,645 | 157 |
| fr | 8,548 | 2,086 | 1,718 | 198 |
| hi | 8,548 | 2,950 | 798 | 93 |
| it | 8,548 | 2,950 | 952 | 215 |
| ja | 8,548 | 2,950 | 692 | 95 |
| ko | 8,548 | 2,950 | 680 | 98 |
| pt | 8,548 | 2,950 | 843 | 145 |

## 3. U+FFFD (�) corruption

| file | keys containing U+FFFD | total U+FFFD chars | raw EF BF BD byte sequences |
|---|---:|---:|---:|
| en.json | 0 | 0 | 0 |
| ar.json | 0 | 0 | 0 |
| de.json | 0 | 0 | 0 |
| es.json | 0 | 0 | 0 |
| fr.json | 0 | 0 | 0 |
| hi.json | 18 | 45 | 45 |
| it.json | 0 | 0 | 0 |
| ja.json | 0 | 0 | 0 |
| ko.json | 0 | 0 | 0 |
| pt.json | 0 | 0 | 0 |

**Only `hi.json` is corrupted: 18 keys, 45 replacement characters** (real U+FFFD bytes in the file, EF BF BD — not a rendering artifact). Every other catalog, including en, is clean. The hi lane's Stack-26 flag is confirmed and the corruption is confined to these keys:

| # | hi key | � count | en value | hi value (corrupted) |
|---:|---|---:|---|---|
| 1 | `artistVault.clothingPlaceholder` | 3 | e.g. all black designer fits, vintage streetwear, no labels... | जैसे सभी काले डिज़ाइ���र फिट, विंटेज स्ट्रीटवियर, कोई लेबल नहीं... |
| 2 | `artistVault.detailLevelHint` | 3 | Controls how tattoos and jewelry are described in AI prompts. Use Video Safe for scene clips to avoid distorted ink and melted chains. | यह नियंत्र���त करता है कि AI संकेतों में टैटू और गहनों का वर्णन कैसे किया जाता है। विकृत स्याही और पिघली हुई जंजीरों से बचने के लिए सीन क्लिप के लिए वीडियो सेफ  |
| 3 | `artistVault.doNotChangePlaceholder` | 2 | e.g. Never show the artist without jewelry. Never use cartoon or anime visual style. Do not use pastel or pink colors. Never generate the artist without their s | जैसे कलाकार को कभी भी बिना गहनों ��े न दिखाएं। कभी भी कार्टून या एनीमे दृश्य शैली का उपयोग न करें। पेस्टल या गुलाबी रंगों का प्रयोग न करें। कभी भी कलाकार को उनक |
| 4 | `artistVault.freeBadge` | 3 | Free | निः���ुल्क |
| 5 | `artistVault.hairPlaceholder` | 2 | e.g. long dreads, black with gold tips... | जैसे लंबे ड्रेड्स, सो��े की टिप्स के साथ काले... |
| 6 | `artistVault.outfitNamePlaceholder` | 2 | Outfit name — e.g. Gold Ceremonial Robe | पोशा�� का नाम - उदा. स्वर्ण समारोहिक वस्त्र |
| 7 | `artistVault.personalityPlaceholder` | 3 | e.g. Young Black artist from Atlanta, street-meets-luxury sound, raw emotion with commercial appeal. Known for cinematic visuals and hard-hitting bars. Started  | जैसे अटलांटा के युवा अश्वेत कलाकार, स्ट्रीट-मीट-लक्ज़री ध्वनि, व्यावसायिक अपील के साथ कच्ची भावना। सिनेमाई दृश्यों और जोरदार बार के लिए जाना जाता है। बिना किसी  |
| 8 | `artistVault.removeOutfitAria` | 3 | Remove outfit from wardrobe | पोशाक क��� अलमारी से हटा दें |
| 9 | `artistVault.songTipRest` | 3 | Heavy effects, buried or doubled vocals, and instrumental-heavy tracks may fail or clone poorly. | भारी प्रभाव, दबे हुए या ���ोगुने स्वर, और वाद्य-भारी ट्रैक विफल हो सकते हैं या खराब तरीके से क्लोन हो सकते हैं। |
| 10 | `brandCalculator.contentTypes.dedicatedVideo.label` | 3 | Dedicated video | ���मर्पित वीडियो |
| 11 | `brandCalculator.perPostNote` | 2 | Recommended ask for 1× {{contentType}} | 1× {{contentType}} के लिए अनुश��सित अनुरोध |
| 12 | `brandCalculator.platforms.youtube.blurb` | 3 | Long-form & Shorts | लॉन्ग-फॉर्म और शॉर्ट्��� |
| 13 | `goLive.failedToPostDiscord` | 2 | Failed to post to Discord. | Discord पर पोस्ट करने में वि��ल. |
| 14 | `locations.save` | 2 | Save | स��ेजें |
| 15 | `sponsorDashboard.tabMyDeals` | 2 | My deals | मेरे सौद�� |
| 16 | `tipPage.recordedBody` | 2 | {{name}} will see your ${{amount}} tip intent. Payments are coming soon — nothing was charged today. | {{name}} आपके ${{amount}} टिप इरादे को देखेगा। भुगतान जल्द ही आ रहे हैं - आज कुछ भी शुल्क नह��ं लिया गया। |
| 17 | `upscale.tabListLabel` | 2 | Upscale & Clean tools | उच्चस्तर��य एवं स्वच्छ उपकरण |
| 18 | `watermarkRemoval.progressNote` | 3 | This runs on our servers — safe to close this tab. Your cleaned video will be waiting in your library. | यह हमारे सर्वर पर चलता है - इस टैब को बंद करना सुरक्षित है। आपका साफ़ किया गया वीडियो आपकी लाइब���रेरी में इंतज़ार कर रहा होगा। |

Namespaces hit: `artistVault` (8), `brandCalculator` (3), and one each in `goLive`, `locations`, `sponsorDashboard`, `tipPage`, `upscale`, `watermarkRemoval`. These 18 keys are present-but-corrupted, so they are **not** in the missing/identical counts — they are additional repair work and are assigned to the first hi wave in §5 (note under the hi wave table). Retranslation must come from en, not from patching the corrupted strings: in several values the lost characters are whole morphemes (e.g. `artistVault.freeBadge` `निः���ुल्क` for en "Free").

## 4. Plural-form infrastructure

### 4.1 What exists

- `src/lib/i18n-plural-forms.test.ts` (Stack-23): 12 former `{{plural}}` keys (`videoEditor.*` ×7, `catalogImport.*` ×3, `liveGuests.toastRevokeEnded`, `playlist.itemsCount`) now exist as full six-suffix CLDR sets (`_zero/_one/_two/_few/_many/_other`) in **all 10 catalogs**; no catalog anywhere still contains `{{plural}}`.
- `src/lib/i18n-plural-categories.test.ts` (Stack-24): plural **families** are derived from en as base keys carrying both `_one` and `_other`. en has **35 families** across 18 namespaces: `beats` (1), `catalogImport` (3), `chooseArtist` (1), `clipMaker` (2), `collabs` (1), `commentReplies` (2), `hub` (2), `liveGuests` (1), `logoMaker` (2), `lyricVideo` (1), `mediaDetector` (1), `playlist` (1), `podcast` (2), `press-kit` (3), `pricing` (2), `promo-clip` (2), `thumbnailTest` (1), `videoEditor` (7).
- Reachable CLDR categories per locale (Intl.PluralRules, as pinned by that test): en/de/hi = one+other; ja/ko = other only; ar = all six; es/fr/it/pt = one+other+**many** (many reachable only at exact millions).
- `press-kit` count families (3) are additionally pinned in the guard file: ar carries all six forms; es/fr/it/pt carry `_many`.

### 4.2 The defect: absent families, not partial families

For every family a locale **carries**, it carries every category it can select — **partial families: 0 in all 9 locales** (verified family-by-family). No locale carries a present family in a single form only. ja/ko carrying a single `_other` form per family is *correct* CLDR behaviour, not a gap. The real defect is families **absent entirely** (they are inside the §1 missing counts and fall back to English at every count):

| locale | families in en | carried | absent entirely | absent families |
|---|---:|---:|---:|---|
| ar | 35 | 33 | 2 | `mediaDetector.filesSkipped`, `thumbnailTest.filesSkipped` |
| de | 35 | 33 | 2 | `mediaDetector.filesSkipped`, `thumbnailTest.filesSkipped` |
| es | 35 | 33 | 2 | `mediaDetector.filesSkipped`, `thumbnailTest.filesSkipped` |
| fr | 35 | 33 | 2 | `mediaDetector.filesSkipped`, `thumbnailTest.filesSkipped` |
| hi | 35 | 29 | 6 | `mediaDetector.filesSkipped`, `pricing.wantedMeter.hoverLabel`, `pricing.wantedMeter.starOption`, `promo-clip.clips.count`, `promo-clip.summary.clipsSelected`, `thumbnailTest.filesSkipped` |
| it | 35 | 29 | 6 | `mediaDetector.filesSkipped`, `pricing.wantedMeter.hoverLabel`, `pricing.wantedMeter.starOption`, `promo-clip.clips.count`, `promo-clip.summary.clipsSelected`, `thumbnailTest.filesSkipped` |
| ja | 35 | 29 | 6 | `mediaDetector.filesSkipped`, `pricing.wantedMeter.hoverLabel`, `pricing.wantedMeter.starOption`, `promo-clip.clips.count`, `promo-clip.summary.clipsSelected`, `thumbnailTest.filesSkipped` |
| ko | 35 | 29 | 6 | `mediaDetector.filesSkipped`, `pricing.wantedMeter.hoverLabel`, `pricing.wantedMeter.starOption`, `promo-clip.clips.count`, `promo-clip.summary.clipsSelected`, `thumbnailTest.filesSkipped` |
| pt | 35 | 29 | 6 | `mediaDetector.filesSkipped`, `pricing.wantedMeter.hoverLabel`, `pricing.wantedMeter.starOption`, `promo-clip.clips.count`, `promo-clip.summary.clipsSelected`, `thumbnailTest.filesSkipped` |

By namespace: `mediaDetector` and `thumbnailTest` plural families are absent in **all 9** locales; `pricing` (2 families) and `promo-clip` (2 families) are absent in **hi/it/ja/ko/pt** only (ar/de/es/fr carry them). Non-family note: `retentionDoctor.type_other` is an option label ("Other"), not a plural form — the plural-categories test explicitly excludes it; the whole `retentionDoctor` namespace is missing in all 9 locales and is counted in §1, not here.

### 4.3 Single-form count strings in en itself (infrastructure gap, all locales)

en carries **255 keys containing `{{count}}`**; **145 of them have no CLDR suffix variants at all** — one invariant string per locale, so the noun can never agree with the count (e.g. `tutorials.chaptersCount` "{count} chapters", `weekly_contest.entries`, `shop.orderRecordedDesc`, `memberships.tierStats`, `myShop.productCount`, `voiceover.wordCount`). Ad-hoc workarounds coexist: `videoExport` carries 16 hand-paired `…One`/`…Other` keys, `labelPitch` has `trackerOne`/`trackerMany`, and `retention` has `streak_days`/`streak_days_plural`. Any namespace wave in §5 that touches a namespace below should split its count keys into CLDR families at the Stack-23 standard rather than translating the single form:

Unsuffixed `{{count}}` keys by namespace: `videoExport` (16), `analyticsHub` (6), `videoEditor` (6), `wave9` (6), `labelPitch` (5), `myProjects` (5), `sounds` (4), `setlist` (4), `playlistPitch` (4), `podcast` (4), `artistVault` (3), `videoTemplatesPage` (3), `voiceover` (3), `websiteBuilder` (3), `movies` (3), `hubSpine` (3), `fomoFeed` (3), `retention` (3), `catalogImport` (3), `invite` (2), `hub` (2), `sponsorDashboard` (2), `sponsorDealDetail` (2), `scriptWriter` (2), `sfx` (2), `titles` (2), `trends` (2), `review` (2), `captionSuite` (2), `wave8` (2), `playlist` (2), `tutorials` (1), `admin` (1), `collabs` (1), `commentReplies` (1), `weekly_contest` (1), `dashboard` (1), `importPage` (1), `introsOutros` (1), `liveShopping` (1), `logoMaker` (1), `makeVideo` (1), `stems` (1), `streamPack` (1), `shop` (1), `thumbnailMaker` (1), `tipPage` (1), `tour` (1), `translate` (1), `upscale` (1), `vocalRemoval` (1), `videoTemplates` (1), `watermarkRemoval` (1), `mastering` (1), `mediaDetector` (1), `memberships` (1), `merch` (1), `promo-clip` (1), `myShop` (1), `nfcCards` (1), `retentionDoctor` (1), `lrcExport` (1), `syncPitch` (1), `liveGuests` (1), `moveHome` (1).

## 5. Recommended waves (commerce first; 300–700 keys per wave; counts = missing + identical, raw)

Ordering: Family 1 Commerce/checkout/money → Family 2 Sponsors/deals/pitching → Family 3 Core shell/home/account → Family 4 Create–video/image → Family 5 Create–audio/music → Family 6 Studio tools/projects/analytics → Family 7 Community/live/social → Family 8 Business/legal/misc → remaining surfaces (incl. guard-pinned namespaces' identical residue, which is mostly legit and shrinks on translator review). Namespaces are packed greedily in that order, largest first within a family, closing a wave at ≥300 keys when the next namespace would exceed ~700. **Wave totals are exact and sum to each locale's raw gap in §1.1.** Translators drop auto-LEGIT identicals (§1.4) as they go, so finished waves will land ~10–20% under the stated count in real translated keys; the stated count is the audited upper bound and the board-sizing number.

### 5.1 ar — 6 waves, 3,667 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| ar-W1 | pricing (111), referrals (88), merch (64), memberships (63), royalties (61), moneyTracker (56), refundPolicy (39), tips (6), myShop (4), storefrontBuilder (3), jewelry (2), liveShopping (2), contracts (2), llcGuide (2), tipPage (2), storefronts (1), jewelryShop (1), brandingShop (1), syncPitch (117), brandDeals (12), distribute (9), sponsors (2), sponsorsPost (2), sponsorDealDetail (2), labelPitch (2), brandCalculator (1), playlistPitch (1) | 656 |
| ar-W2 | retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), delight (9), academy (5), common (4), home (3), auth (2), features (2), waitlist (2), promo-clip (120), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43), cartoonStudio (41) | 692 |
| ar-W3 | bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (16), avatarPresenter (12), thumbnailStudio (7), thumbnailMaker (6), makeVideo (4), songAndVideo (4), thumbnail (4), thumbnailTest (2), thumbnails (1), clipMaker (1), watermarkRemoval (1), logoMaker (1), captionStyler (1), harmony (73), mixMaster (71), deverb (50), fillerRemover (50), lrcExport (47), mastering (46), samples (44) | 699 |
| ar-W4 | vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), singingVoice (26), stems (23), bgReplace (21), aiAudio (12), songs (8), beatMaker (6), sounds (4), beats (3), translate (2), makeSong (1), sfx (1), voiceover (1), scheduler (205), myProjects (86), mashup (57), repurpose (52) | 687 |
| ar-W5 | myClips (39), hooks (33), mediaDetector (31), randomizer (27), scriptWriter (21), library (15), artistVault (12), catalogVault (10), streamPack (10), viralityCheck (6), importPage (4), audit (4), titles (4), email-list (3), interviewPrep (3), trends (3), chooseArtist (2), retention (2), generations (1), analytics (1), setlist (1), linkInBio (83), weekly_contest (25), discord-bot (4), shoutouts (4), community (2), collabs (2), goLive (2), contests (2), team (2), extension (2), shows (1), tour (1), nfcCards (73), privacy (51) | 486 |
| ar-W6 | promote (42), coach (29), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (1), locations (1), milestones (63), lufs (53), presave (46), release (39), stabilize (31), create (22), press-public (15), captionSuite (7), outreach (7), press-kit (7), videoEditor (7), contentIntelligence (6), moveHome (6), podcast (6), hubSpine (5), admin (4), nav (4), cover-art (3), videoExport (3), analyticsHub (2), djSets (2), share (2), wave9 (2), brandingKit (1), dashboard (1), paidSeries (1), proFinishing (1), review (1), tutorials (1), wave8 (1) | 447 |

### 5.2 de — 7 waves, 4,268 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| de-W1 | pricing (115), referrals (88), merch (64), memberships (63), royalties (61), moneyTracker (56), refundPolicy (39), brandingShop (9), liveShopping (8), myShop (7), llcGuide (7), storefrontBuilder (6), tips (6), jewelry (5), contracts (4), credit-history (2), storefronts (2), jewelryShop (2), tipPage (2), shop (1), syncPitch (117), brandDeals (23) | 687 |
| de-W2 | distribute (22), labelPitch (12), brandCalculator (9), playlistPitch (8), sponsorsPost (4), sponsorDealDetail (4), sponsors (2), retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), home (13), betaAccess (11), waitlist (11), delight (9), academy (7), common (6), guides (3), features (3), auth (1), promo-clip (124), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56) | 661 |
| de-W3 | movies (49), motionGraphics (43), cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), makeVideo (25), songAndVideo (25), photoShoot (25), upscale (18), thumbnail (15), thumbnailMaker (13), avatarPresenter (12), thumbnailStudio (7), logoMaker (7), captionStyler (7), clipMaker (6), thumbnailTest (4), thumbnails (1), watermarkRemoval (1), harmony (73), mixMaster (71) | 676 |
| de-W4 | deverb (50), fillerRemover (50), lrcExport (47), mastering (46), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), stems (27), singingVoice (26), beatMaker (21), bgReplace (21), makeSong (16), sounds (14), songs (12), aiAudio (12), beats (11), sfx (6), audioCleanup (4), vocalRemoval (3), voiceover (3), translate (3) | 595 |
| de-W5 | scheduler (205), myProjects (87), mashup (57), repurpose (53), myClips (39), hooks (39), mediaDetector (31), randomizer (27), scriptWriter (26), artistVault (22), library (15), viralityCheck (12), streamPack (11), trends (11), catalogVault (10), titles (9), email-list (8), audit (8), interviewPrep (8), importPage (7), retention (6), introsOutros (6), generations (3) | 700 |
| de-W6 | chooseArtist (3), analytics (3), setlist (2), content-calendar (1), hub (1), linkInBio (83), weekly_contest (25), tour (8), community (7), shows (7), discord-bot (6), collabs (5), team (5), gamers (4), contests (4), extension (4), commentReplies (4), shoutouts (4), goLive (3), nfcCards (73), privacy (51), promote (42), coach (37), nfcCardProfile (10), qrLogin (9), notFound (6), websiteBuilder (4), copyright (3), contact (1), locations (1), milestones (63) | 479 |
| de-W7 | videoEditor (61), lufs (53), presave (46), release (39), stabilize (31), nav (24), create (22), moveHome (16), press-kit (15), press-public (15), wave9 (15), wave8 (13), podcast (11), outreach (10), admin (9), contentIntelligence (9), captionSuite (8), dashboard (8), videoExport (8), analyticsHub (7), brandingKit (6), cover-art (6), hubSpine (6), proFinishing (5), playlist (4), review (3), settings (3), tutorials (3), djSets (2), paidSeries (2), share (2), smartClips (2), wallpapers (2), catalogImport (1), create-simple (1), liveGuests (1), showcasePublish (1) | 470 |

### 5.3 es — 6 waves, 3,888 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| es-W1 | pricing (115), referrals (88), merch (64), memberships (63), royalties (61), moneyTracker (56), refundPolicy (39), myShop (6), jewelry (5), llcGuide (5), brandingShop (4), tips (4), storefrontBuilder (3), liveShopping (3), contracts (3), jewelryShop (2), tipPage (2), shop (1), storefronts (1), syncPitch (117), brandDeals (14), labelPitch (11), distribute (10), brandCalculator (3), sponsors (2), sponsorsPost (2), sponsorDealDetail (2), playlistPitch (1) | 687 |
| es-W2 | retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), home (10), delight (9), academy (7), common (6), features (3), waitlist (3), auth (1), signup (1), betaAccess (1), promo-clip (124), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 669 |
| es-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (17), makeVideo (15), songAndVideo (15), avatarPresenter (12), thumbnailMaker (8), thumbnailStudio (7), thumbnail (6), clipMaker (4), logoMaker (3), captionStyler (3), thumbnailTest (2), thumbnails (1), watermarkRemoval (1), harmony (73), mixMaster (71), deverb (50), fillerRemover (50), lrcExport (47) | 684 |
| es-W4 | mastering (46), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), stems (26), singingVoice (26), bgReplace (21), beatMaker (17), aiAudio (12), makeSong (10), songs (10), sounds (5), sfx (5), beats (4), translate (4), vocalRemoval (1), audioCleanup (1), voiceover (1), scheduler (205) | 617 |
| es-W5 | myProjects (86), mashup (57), repurpose (53), myClips (39), hooks (34), mediaDetector (31), scriptWriter (28), randomizer (27), library (15), artistVault (12), catalogVault (10), streamPack (10), importPage (7), titles (6), viralityCheck (6), retention (5), interviewPrep (5), trends (5), email-list (4), chooseArtist (3), analytics (3), audit (3), generations (2), introsOutros (2), setlist (2), hub (1), linkInBio (83), weekly_contest (25), community (4), shows (4), discord-bot (4), collabs (3), extension (3), contests (2), team (2), commentReplies (2), shoutouts (2), tour (1), nfcCards (73) | 664 |
| es-W6 | privacy (51), promote (41), coach (32), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (1), locations (1), milestones (63), lufs (53), presave (46), release (39), stabilize (31), videoEditor (26), create (22), press-public (15), videoExport (15), nav (11), moveHome (10), press-kit (10), outreach (9), wave8 (9), podcast (8), captionSuite (7), contentIntelligence (7), hubSpine (6), wave9 (5), admin (4), cover-art (3), dashboard (3), djSets (2), share (2), tutorials (2), analyticsHub (1), brandingKit (1), command (1), paidSeries (1), playlist (1), proFinishing (1), review (1), smartClips (1) | 567 |

### 5.4 fr — 6 waves, 4,002 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| fr-W1 | pricing (115), referrals (88), merch (64), memberships (63), royalties (61), moneyTracker (56), refundPolicy (39), myShop (8), jewelry (6), liveShopping (6), tips (6), storefrontBuilder (5), credit-history (4), brandingShop (4), contracts (4), llcGuide (4), tipPage (2), shop (1), storefronts (1), jewelryShop (1), syncPitch (117), brandDeals (16), labelPitch (15), distribute (14) | 700 |
| fr-W2 | brandCalculator (6), sponsorsPost (5), playlistPitch (5), sponsors (2), sponsorDashboard (2), sponsorDealDetail (2), retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), home (9), delight (9), academy (8), common (5), waitlist (5), guides (3), features (3), betaAccess (2), auth (1), promo-clip (124), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 695 |
| fr-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), makeVideo (19), upscale (17), songAndVideo (15), avatarPresenter (12), thumbnailMaker (10), thumbnailStudio (7), thumbnail (6), logoMaker (5), clipMaker (3), thumbnailTest (2), captionStyler (2), thumbnails (1), watermarkRemoval (1), harmony (73), mixMaster (71), deverb (50), fillerRemover (50), lrcExport (47) | 690 |
| fr-W4 | mastering (46), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), stems (26), singingVoice (26), bgReplace (21), makeSong (14), beatMaker (13), aiAudio (12), sounds (10), songs (9), beats (8), sfx (5), vocalRemoval (3), voiceover (3), translate (3), audioCleanup (2), scheduler (203) | 627 |
| fr-W5 | myProjects (86), mashup (57), repurpose (53), myClips (39), hooks (33), mediaDetector (31), scriptWriter (27), randomizer (27), library (15), artistVault (13), catalogVault (10), streamPack (10), titles (9), interviewPrep (8), trends (7), email-list (6), viralityCheck (6), retention (5), importPage (4), chooseArtist (3), audit (3), generations (2), hub (2), introsOutros (2), setlist (2), analytics (1), linkInBio (83), weekly_contest (25), community (7), shows (5), discord-bot (5), collabs (4), tour (4), extension (4), shoutouts (4), contests (3), gamers (2), team (2), commentReplies (2), goLive (1), nfcCards (73) | 685 |
| fr-W6 | privacy (51), promote (41), coach (30), nfcCardProfile (10), qrLogin (9), notFound (5), terms (2), copyright (2), contact (2), locations (1), websiteBuilder (1), download (1), milestones (63), lufs (53), presave (46), release (39), videoEditor (33), stabilize (31), create (22), press-kit (15), press-public (15), wave8 (15), podcast (11), videoExport (11), moveHome (10), nav (10), captionSuite (9), contentIntelligence (9), outreach (9), hubSpine (8), wave9 (8), cover-art (6), analyticsHub (5), admin (4), proFinishing (4), djSets (2), share (2), brandingKit (1), catalogImport (1), dashboard (1), paidSeries (1), playlist (1), review (1), settings (1), showcasePublish (1), smartClips (1), tutorials (1) | 605 |

### 5.5 hi — 6 waves, 3,841 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| hi-W1 | pricing (121), referrals (88), memberships (66), merch (64), royalties (61), moneyTracker (56), refundPolicy (39), tips (6), myShop (5), storefrontBuilder (5), brandingShop (4), llcGuide (4), liveShopping (3), jewelryShop (2), contracts (2), tipPage (2), storefronts (1), jewelry (1), syncPitch (117), labelPitch (23), brandDeals (12), distribute (9), sponsorsPost (5), sponsors (2), sponsorDealDetail (2) | 700 |
| hi-W2 | brandCalculator (1), playlistPitch (1), retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), delight (9), academy (7), home (4), common (4), features (2), waitlist (2), auth (1), promo-clip (128), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 663 |
| hi-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (14), avatarPresenter (12), thumbnailMaker (7), thumbnailStudio (7), captionStyler (6), makeVideo (5), songAndVideo (5), thumbnail (4), thumbnailTest (3), clipMaker (2), thumbnails (1), watermarkRemoval (1), logoMaker (1), mixMaster (74), harmony (73), deverb (50), fillerRemover (50), mastering (47) | 661 |
| hi-W4 | lrcExport (47), samples (44), vocalPolish (41), vocalTune (40), songRework (35), makeSong (33), producerTag (33), audioStudio (30), singingVoice (26), stems (24), bgReplace (21), beatMaker (19), aiAudio (12), beats (9), songs (8), sounds (4), translate (2), vocalRemoval (1), lyricVideo (1), voiceover (1), scheduler (205) | 636 |
| hi-W5 | myProjects (86), mashup (57), repurpose (52), myClips (43), hooks (33), mediaDetector (31), randomizer (29), scriptWriter (25), library (15), artistVault (12), catalogVault (10), streamPack (10), viralityCheck (6), importPage (5), audit (5), retention (5), titles (5), email-list (3), chooseArtist (3), interviewPrep (3), trends (3), analytics (2), setlist (2), generations (1), linkInBio (83), weekly_contest (25), discord-bot (6), tour (5), extension (5), shows (4), shoutouts (4), community (3), collabs (3), team (3), commentReplies (3), contests (2), gamers (1), nfcCards (73) | 666 |
| hi-W6 | privacy (51), promote (44), coach (32), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (4), fog-lab (3), locations (1), milestones (63), lufs (53), presave (46), release (39), stabilize (31), create (22), press-public (15), videoEditor (9), captionSuite (7), outreach (7), press-kit (7), contentIntelligence (6), moveHome (6), nav (6), podcast (6), hubSpine (5), admin (4), cover-art (4), videoExport (4), analyticsHub (2), djSets (2), share (2), wave9 (2), brandingKit (1), dashboard (1), paidSeries (1), proFinishing (1), review (1), tutorials (1), wave8 (1) | 515 |

**hi must also retranslate the 18 U+FFFD-corrupted keys in §3 from en** (artistVault ×8, brandCalculator ×3, goLive, locations, sponsorDashboard, tipPage, upscale, watermarkRemoval). They are present-but-corrupted, so they are additional to every wave count; attach each to the wave that owns its namespace (tipPage → hi-W1, brandCalculator → hi-W2, upscale + watermarkRemoval → hi-W3, artistVault → hi-W5, locations → hi-W6). `goLive` and `sponsorDashboard` have zero missing+identical gap and appear in no wave — their corrupted keys ride along with hi-W1 as a standalone add-on.

### 5.6 it — 7 waves, 4,117 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| it-W1 | pricing (121), referrals (88), memberships (66), merch (64), royalties (61), moneyTracker (56), refundPolicy (39), liveShopping (6), llcGuide (6), tips (6), myShop (5), jewelry (5), storefrontBuilder (4), brandingShop (4), contracts (4), jewelryShop (2), tipPage (2), credit-history (1), shop (1), storefronts (1), syncPitch (117), brandDeals (22) | 681 |
| it-W2 | labelPitch (20), distribute (14), brandCalculator (8), playlistPitch (6), sponsorsPost (4), sponsorDealDetail (3), sponsors (2), sponsorDashboard (2), retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), home (9), delight (9), academy (8), common (6), waitlist (6), betaAccess (4), auth (3), signup (3), features (3), guides (1), promo-clip (128), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49) | 700 |
| it-W3 | motionGraphics (43), cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), makeVideo (20), songAndVideo (19), upscale (18), avatarPresenter (12), thumbnail (10), thumbnailMaker (9), logoMaker (8), thumbnailStudio (7), captionStyler (6), clipMaker (5), thumbnailTest (4), thumbnails (1), watermarkRemoval (1), mixMaster (74), harmony (73), deverb (50) | 659 |
| it-W4 | fillerRemover (50), mastering (47), lrcExport (47), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), stems (26), singingVoice (26), beatMaker (21), bgReplace (21), makeSong (16), aiAudio (12), sounds (11), songs (10), beats (7), sfx (6), voiceover (5), translate (4), vocalRemoval (2) | 534 |
| it-W5 | scheduler (205), myProjects (86), mashup (57), repurpose (53), myClips (43), hooks (34), mediaDetector (31), scriptWriter (30), randomizer (27), library (15), artistVault (12), catalogVault (10), streamPack (10), importPage (7), viralityCheck (7), email-list (6), titles (6), interviewPrep (6), trends (6), audit (4), chooseArtist (3), introsOutros (3), generations (2), hub (2), analytics (2), retention (2), setlist (2), content-calendar (1) | 672 |
| it-W6 | linkInBio (83), weekly_contest (25), community (7), collabs (7), team (6), discord-bot (5), tour (4), extension (4), shoutouts (4), goLive (3), shows (3), contests (3), gamers (2), commentReplies (2), nfcCards (73), privacy (51), promote (44), coach (38), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (3), websiteBuilder (2), contact (1), locations (1), milestones (63) | 459 |
| it-W7 | lufs (53), presave (46), videoEditor (41), release (39), stabilize (31), create (22), nav (16), press-public (15), press-kit (14), moveHome (13), videoExport (13), wave8 (10), outreach (9), podcast (9), admin (8), analyticsHub (8), captionSuite (8), wave9 (7), contentIntelligence (6), hubSpine (6), cover-art (5), playlist (5), dashboard (4), liveGuests (3), proFinishing (3), review (3), wallpapers (3), djSets (2), settings (2), share (2), tutorials (2), brandingKit (1), paidSeries (1), smartClips (1), socialProof (1) | 412 |

### 5.7 ja — 6 waves, 3,737 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| ja-W1 | pricing (121), referrals (88), memberships (66), merch (64), royalties (61), moneyTracker (56), refundPolicy (39), tips (6), myShop (5), storefrontBuilder (4), contracts (2), tipPage (2), storefronts (1), jewelry (1), jewelryShop (1), brandingShop (1), liveShopping (1), llcGuide (1), syncPitch (117), brandDeals (8), distribute (8), sponsors (2), sponsorsPost (2), sponsorDealDetail (2), labelPitch (2), brandCalculator (1), playlistPitch (1) | 663 |
| ja-W2 | retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), delight (9), home (5), academy (5), common (4), auth (2), features (2), waitlist (2), promo-clip (128), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 661 |
| ja-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (16), avatarPresenter (12), thumbnailStudio (7), songAndVideo (6), thumbnailMaker (6), makeVideo (5), captionStyler (5), thumbnail (4), thumbnailTest (2), thumbnails (1), clipMaker (1), watermarkRemoval (1), logoMaker (1), mixMaster (74), harmony (73), deverb (50), fillerRemover (50), mastering (47) | 660 |
| ja-W4 | lrcExport (47), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), singingVoice (26), stems (25), bgReplace (21), beatMaker (19), aiAudio (12), songs (8), beats (5), sounds (4), makeSong (2), translate (2), sfx (1), lyricVideo (1), voiceover (1), scheduler (205), myProjects (86) | 688 |
| ja-W5 | mashup (57), repurpose (52), myClips (43), hooks (34), mediaDetector (31), randomizer (27), scriptWriter (22), library (15), artistVault (12), catalogVault (10), streamPack (10), viralityCheck (6), retention (5), titles (5), email-list (4), importPage (4), audit (4), interviewPrep (4), chooseArtist (3), trends (3), generations (1), setlist (1), linkInBio (83), weekly_contest (25), discord-bot (4), shoutouts (4), team (3), community (2), collabs (2), contests (2), extension (2), goLive (1), shows (1), tour (1), nfcCards (73), privacy (51), promote (44), coach (30), nfcCardProfile (10), qrLogin (9) | 700 |
| ja-W6 | notFound (6), copyright (1), locations (1), websiteBuilder (1), milestones (63), lufs (53), presave (46), release (39), stabilize (31), create (22), press-public (15), videoEditor (9), captionSuite (7), outreach (7), press-kit (7), contentIntelligence (6), moveHome (6), podcast (6), admin (5), hubSpine (5), nav (4), videoExport (4), analyticsHub (3), cover-art (3), wave9 (3), djSets (2), share (2), brandingKit (1), dashboard (1), paidSeries (1), playlist (1), proFinishing (1), review (1), tutorials (1), wave8 (1) | 365 |

### 5.8 ko — 6 waves, 3,728 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| ko-W1 | pricing (121), referrals (88), memberships (66), merch (64), royalties (61), moneyTracker (56), refundPolicy (39), tips (6), myShop (5), storefrontBuilder (4), contracts (2), tipPage (2), storefronts (1), jewelry (1), jewelryShop (1), brandingShop (1), liveShopping (1), llcGuide (1), syncPitch (117), brandDeals (12), distribute (11), sponsors (2), sponsorsPost (2), sponsorDealDetail (2), labelPitch (2), brandCalculator (1), playlistPitch (1) | 670 |
| ko-W2 | retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), planPublic (15), delight (9), home (6), academy (6), common (4), auth (2), features (2), waitlist (2), promo-clip (128), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 663 |
| ko-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (14), avatarPresenter (12), thumbnailStudio (7), makeVideo (5), thumbnailMaker (5), songAndVideo (4), thumbnail (4), thumbnailTest (2), thumbnails (1), clipMaker (1), watermarkRemoval (1), logoMaker (1), captionStyler (1), mixMaster (74), harmony (73), deverb (50), fillerRemover (50), mastering (47), lrcExport (47) | 698 |
| ko-W4 | samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), singingVoice (26), stems (23), bgReplace (21), aiAudio (12), songs (8), beatMaker (6), beats (5), sounds (4), makeSong (2), translate (2), sfx (1), lyricVideo (1), voiceover (1), scheduler (205), myProjects (86), mashup (57) | 683 |
| ko-W5 | repurpose (52), myClips (43), hooks (34), mediaDetector (31), randomizer (27), scriptWriter (21), library (15), artistVault (12), catalogVault (10), streamPack (10), viralityCheck (6), retention (5), titles (5), email-list (4), importPage (4), audit (4), interviewPrep (3), trends (3), chooseArtist (2), generations (1), analytics (1), setlist (1), linkInBio (83), weekly_contest (25), discord-bot (5), shoutouts (4), community (3), team (3), extension (3), collabs (2), contests (2), goLive (1), shows (1), tour (1), commentReplies (1), nfcCards (73), privacy (51), promote (44), coach (30), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (1), locations (1), websiteBuilder (1) | 654 |
| ko-W6 | milestones (63), lufs (53), presave (46), release (39), stabilize (31), create (22), press-public (15), videoEditor (13), press-kit (8), captionSuite (7), outreach (7), contentIntelligence (6), moveHome (6), podcast (6), hubSpine (5), admin (4), cover-art (4), nav (4), videoExport (4), wave9 (3), analyticsHub (2), djSets (2), share (2), brandingKit (1), dashboard (1), paidSeries (1), playlist (1), proFinishing (1), review (1), tutorials (1), wave8 (1) | 360 |

### 5.9 pt — 6 waves, 3,938 keys

| wave | namespaces (gap) | keys |
|---|---|---:|
| pt-W1 | pricing (121), referrals (88), memberships (66), merch (64), royalties (61), moneyTracker (56), refundPolicy (39), llcGuide (6), tips (6), myShop (5), jewelry (5), storefrontBuilder (4), liveShopping (4), brandingShop (3), jewelryShop (2), contracts (2), tipPage (2), credit-history (1), shop (1), storefronts (1), syncPitch (117), labelPitch (13), distribute (12), brandDeals (10), playlistPitch (6), brandCalculator (4) | 699 |
| pt-W2 | sponsorDealDetail (3), sponsors (2), sponsorsPost (2), retentionDoctor (55), retentionDelight (40), invite (29), fomoFeed (22), home (21), planPublic (15), academy (9), delight (9), common (6), waitlist (5), betaAccess (3), features (2), auth (1), promo-clip (128), splitScreen (70), productPhotoStudio (67), carouselMaker (58), videoTemplates (56), movies (49), motionGraphics (43) | 695 |
| pt-W3 | cartoonStudio (41), bgStudio (39), headshotStudio (38), colorGrade (36), photoEnhance (33), speedRamp (32), captionTemplates (28), videoTemplatesPage (27), photoShoot (25), upscale (16), makeVideo (15), songAndVideo (15), avatarPresenter (12), thumbnailMaker (9), thumbnail (7), thumbnailStudio (7), clipMaker (4), thumbnailTest (3), thumbnails (2), logoMaker (2), captionStyler (2), watermarkRemoval (1), mixMaster (74), harmony (73), deverb (50), fillerRemover (50), mastering (47) | 688 |
| pt-W4 | lrcExport (47), samples (44), vocalPolish (41), vocalTune (40), songRework (35), producerTag (33), audioStudio (30), singingVoice (26), stems (24), beatMaker (22), bgReplace (21), aiAudio (12), makeSong (11), songs (10), beats (8), sounds (6), sfx (6), translate (3), vocalRemoval (2), audioCleanup (1), voiceover (1), scheduler (205) | 628 |
| pt-W5 | myProjects (86), mashup (57), repurpose (53), myClips (43), hooks (36), mediaDetector (31), scriptWriter (27), randomizer (27), library (15), artistVault (13), catalogVault (10), streamPack (10), viralityCheck (8), titles (7), interviewPrep (7), audit (5), trends (5), email-list (4), importPage (4), chooseArtist (2), analytics (2), retention (2), introsOutros (2), setlist (2), generations (1), hub (1), linkInBio (83), weekly_contest (25), shows (4), discord-bot (4), contests (3), team (3), extension (3), shoutouts (3), community (2), collabs (2), gamers (2), tour (2), commentReplies (2), goLive (1), nfcCards (73) | 672 |
| pt-W6 | privacy (51), promote (44), coach (32), nfcCardProfile (10), qrLogin (9), notFound (6), copyright (1), locations (1), websiteBuilder (1), milestones (63), lufs (53), presave (46), release (39), stabilize (31), create (22), videoEditor (18), press-public (15), press-kit (11), wave8 (10), nav (9), outreach (9), moveHome (8), videoExport (8), captionSuite (7), podcast (7), admin (6), contentIntelligence (6), hubSpine (6), wave9 (5), cover-art (3), playlist (3), dashboard (2), djSets (2), proFinishing (2), review (2), share (2), analyticsHub (1), brandingKit (1), paidSeries (1), smartClips (1), tutorials (1), wallpapers (1) | 556 |

### 5.10 Wave table (summary — board-ready)

| locale | wave | key count | lead namespaces |
|---|---|---:|---|
| ar | ar-W1 | 656 | pricing, referrals, merch, memberships |
| ar | ar-W2 | 692 | retentionDoctor, retentionDelight, invite, fomoFeed |
| ar | ar-W3 | 699 | bgStudio, headshotStudio, colorGrade, photoEnhance |
| ar | ar-W4 | 687 | vocalPolish, vocalTune, songRework, producerTag |
| ar | ar-W5 | 486 | myClips, hooks, mediaDetector, randomizer |
| ar | ar-W6 | 447 | promote, coach, nfcCardProfile, qrLogin |
| de | de-W1 | 687 | pricing, referrals, merch, memberships |
| de | de-W2 | 661 | distribute, labelPitch, brandCalculator, playlistPitch |
| de | de-W3 | 676 | movies, motionGraphics, cartoonStudio, bgStudio |
| de | de-W4 | 595 | deverb, fillerRemover, lrcExport, mastering |
| de | de-W5 | 700 | scheduler, myProjects, mashup, repurpose |
| de | de-W6 | 479 | chooseArtist, analytics, setlist, content-calendar |
| de | de-W7 | 470 | videoEditor, lufs, presave, release |
| es | es-W1 | 687 | pricing, referrals, merch, memberships |
| es | es-W2 | 669 | retentionDoctor, retentionDelight, invite, fomoFeed |
| es | es-W3 | 684 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| es | es-W4 | 617 | mastering, samples, vocalPolish, vocalTune |
| es | es-W5 | 664 | myProjects, mashup, repurpose, myClips |
| es | es-W6 | 567 | privacy, promote, coach, nfcCardProfile |
| fr | fr-W1 | 700 | pricing, referrals, merch, memberships |
| fr | fr-W2 | 695 | brandCalculator, sponsorsPost, playlistPitch, sponsors |
| fr | fr-W3 | 690 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| fr | fr-W4 | 627 | mastering, samples, vocalPolish, vocalTune |
| fr | fr-W5 | 685 | myProjects, mashup, repurpose, myClips |
| fr | fr-W6 | 605 | privacy, promote, coach, nfcCardProfile |
| hi | hi-W1 | 700 | pricing, referrals, memberships, merch |
| hi | hi-W2 | 663 | brandCalculator, playlistPitch, retentionDoctor, retentionDelight |
| hi | hi-W3 | 661 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| hi | hi-W4 | 636 | lrcExport, samples, vocalPolish, vocalTune |
| hi | hi-W5 | 666 | myProjects, mashup, repurpose, myClips |
| hi | hi-W6 | 515 | privacy, promote, coach, nfcCardProfile |
| it | it-W1 | 681 | pricing, referrals, memberships, merch |
| it | it-W2 | 700 | labelPitch, distribute, brandCalculator, playlistPitch |
| it | it-W3 | 659 | motionGraphics, cartoonStudio, bgStudio, headshotStudio |
| it | it-W4 | 534 | fillerRemover, mastering, lrcExport, samples |
| it | it-W5 | 672 | scheduler, myProjects, mashup, repurpose |
| it | it-W6 | 459 | linkInBio, weekly_contest, community, collabs |
| it | it-W7 | 412 | lufs, presave, videoEditor, release |
| ja | ja-W1 | 663 | pricing, referrals, memberships, merch |
| ja | ja-W2 | 661 | retentionDoctor, retentionDelight, invite, fomoFeed |
| ja | ja-W3 | 660 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| ja | ja-W4 | 688 | lrcExport, samples, vocalPolish, vocalTune |
| ja | ja-W5 | 700 | mashup, repurpose, myClips, hooks |
| ja | ja-W6 | 365 | notFound, copyright, locations, websiteBuilder |
| ko | ko-W1 | 670 | pricing, referrals, memberships, merch |
| ko | ko-W2 | 663 | retentionDoctor, retentionDelight, invite, fomoFeed |
| ko | ko-W3 | 698 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| ko | ko-W4 | 683 | samples, vocalPolish, vocalTune, songRework |
| ko | ko-W5 | 654 | repurpose, myClips, hooks, mediaDetector |
| ko | ko-W6 | 360 | milestones, lufs, presave, release |
| pt | pt-W1 | 699 | pricing, referrals, memberships, merch |
| pt | pt-W2 | 695 | sponsorDealDetail, sponsors, sponsorsPost, retentionDoctor |
| pt | pt-W3 | 688 | cartoonStudio, bgStudio, headshotStudio, colorGrade |
| pt | pt-W4 | 628 | lrcExport, samples, vocalPolish, vocalTune |
| pt | pt-W5 | 672 | myProjects, mashup, repurpose, myClips |
| pt | pt-W6 | 556 | privacy, promote, coach, nfcCardProfile |

## Appendix — reproducibility & notes

- Flattening, missing/identical/extra, guard derivation, FFFD scan, plural-family derivation and wave packing were all computed in one pass over the JSON files at `0bdfcefa`; the guard derivation replicates `locale-newest-surfaces.test.ts` line-for-line (WHOLE_NAMESPACES, BLOCK_PREFIXES, EMAIL_LIST_BLOCK, SINGLES) and reproduces its pinned total of 4,284 exactly, which cross-validates the replication.
- Identical comparison is exact value equality after flattening (strings by value, arrays by element sequence) — the same equality the guard's residue describes use.
- Two missing-set groups exist, consistent with the hi/it/ja/ko/pt catalogs having been filled from an older en snapshot than ar/de/es/fr: the 864-key difference breaks down as `promo-clip` 127, `pricing` 121, `nfcCards` 73, `myProjects` 72, `merch` 62, `memberships` 60, `mixMaster` 57, `privacy` 51, `movies` 48, `mastering` 47, `promote` 42, `myClips` 36, `mediaDetector` 29, `press-public` 15, `nfcCardProfile` 10, `presave` 8, `notFound` 6 — see §1.2 for the exact per-namespace split.
- This audit is read-only: no catalog, test, or source file was modified.
