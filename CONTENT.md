# Content sources, normalization, and review

This file is the content provenance record for the 48-book reader. The published corpus contains Samuel Butler's English narrative text, a new AI-generated Japanese translation of that English, and AI-generated Japanese reading notes. The Japanese text is not translated directly from ancient Greek. It is an AI draft, not an expert-reviewed edition.

## Sources and rights basis

The English source is Samuel Butler's translation, retrieved on 2026-10-10 from the Project Gutenberg plain-text editions:

| Work | Project Gutenberg record | Raw bytes | SHA-256 | Narrative paragraphs |
| :--- | :--- | ---: | :--- | ---: |
| Iliad | [Ebook 2199](https://www.gutenberg.org/ebooks/2199) | 929,005 | `a7a39e3467305472fcd5ee0e42fc93d069449171cf1758f2a42cfae8b2da2774` | 1,113 |
| Odyssey | [Ebook 1727](https://www.gutenberg.org/ebooks/1727) | 717,663 | `268cf938678308dbebbea0aee320567f2d9aac31087e557f43a70708676efc7a` | 1,027 |

Project Gutenberg identifies Butler (1835–1902) as translator and labels both records public domain in the United States. Its [license policy](https://www.gutenberg.org/policy/license.html) permits reuse of the underlying text without retaining Project Gutenberg branding or its license boilerplate. The source acquisition uses the plain-text ebook files and the published corpus does not reproduce Project Gutenberg branding or the license. The source link and this provenance record identify the edition.

For Japan, the 2018 copyright term extension did not revive works whose terms had already expired. Even allowing the former 50-year term, the extended 70-year term, and the applicable wartime extension, Butler's 1902 death is sufficiently remote for the translation to have entered the public domain before that amendment. See the [Agency for Cultural Affairs explanation](https://www.bunka.go.jp/seisaku/chosakuken/hokaisei/kantaiheiyo_chosakuken/1411890.html). This records the basis used for this project; it is not a jurisdiction-by-jurisdiction legal opinion.

## What the importer includes

The importer selects the last complete `BOOK I` through `BOOK XXIV` sequence in each source, which is the actual book text rather than its contents list. It joins lines wrapped within a paragraph with spaces and preserves paragraph boundaries, punctuation, and wording. References such as `Iliad 1, paragraph 1` identify Butler-text paragraphs after the documented editorial exclusions; they are not Greek line numbers.

The following source apparatus is excluded from reader units so it cannot appear as default narrative or expose later events:

| Exclusion | Iliad | Odyssey | Handling |
| :--- | ---: | ---: | :--- |
| First editorial synopsis or chapter heading after each `BOOK` marker | 24 blocks | 24 blocks | Excluded from units; the exact 48 strings are retained only in the non-public `/tmp/homer-reader-source/source-manifest.json` audit output. The published `public/data/source-manifest.json` records their per-book hashes. Iliad blocks are checked against dash-separated or short title patterns, with explicit checked patterns for books 10, 15, and 19. Odyssey blocks must be uppercase editorial headings. |
| Detached Butler `FOOTNOTES:` section | 0 | 187 numbered notes in 205 text blocks | The whole Odyssey endnote section after the final narrative paragraph is excluded. Its text is kept only in the non-public source manifest for audit. The published manifest records counts, not note text. |
| Inline endnote reference digits | 0 | 186 | Removed from Odyssey narrative paragraphs to avoid orphan numbers. The source digits are exactly 1–187 except 88; 88 appears only in the excluded Book 11 heading. The importer rejects any other sequence. |
| Project Gutenberg material after `*** END OF THE PROJECT GUTENBERG EBOOK ... ***` | 51 blocks | 50 blocks | Excluded as license and legal boilerplate. |

The paragraph accounting is explicit: the preliminary extraction counted 2,494 blocks; 101 post-ebook legal blocks (51 Iliad + 50 Odyssey), 48 editorial headings/synopses (24 each), and 205 detached Odyssey endnote text blocks are excluded, leaving 2,140 narrative units (1,113 Iliad + 1,027 Odyssey; 268,999 English words). Removing Odyssey's 186 inline note digits changes text normalization, not the unit count. The temporary source manifest records each source hash, exact excluded editorial/endnote text, marker sequence, and block counts; it is not published. A sanitized `public/data/source-manifest.json` records raw source hashes, normalization and exclusion counts, and per-book narrative counts, boundaries, and a digest over every ordered `{id,en}` pair. `validate-content.py --verify-published` checks all 48 published book files against that committed manifest without network access. During assembly, each normalized English paragraph is also compared exactly with a fresh parse of the checked raw source bytes before its digest is recorded.

The openings `Sing, O goddess...` and `Tell me, O Muse...` and the final narrative paragraphs of both works are retained. Parser tests cover all 24 book boundaries, editorial-block rejection, line-wrap normalization, endnote removal, marker cleanup, and post-ebook boilerplate exclusion.

## Japanese translation and notes

Every Japanese paragraph is newly AI-generated from its paired Butler English paragraph. The controller checks that output IDs and order exactly match the input batch, Japanese text is non-empty and not left in English, and translations are not suspiciously short. Commentary is generated only from the supplied paragraph batch, with later-plot references prohibited unless explicitly marked as spoilers. Each book must contain at least one note. For all 1,375 notes, the English title and body are AI translations of the existing Japanese title and body; they do not introduce new note content. Automated checks do not establish semantic accuracy or full human review.

The translation convention maps Butler's Romanized divine names to familiar Greek names: Jove/Jupiter → ゼウス, Juno → ヘラ, Minerva → アテナ, and Neptune → ポセイドン. Ulysses → オデュッセウス, Troy → トロイア, and Achaeans → アカイア勢. No claim is made that Butler's paragraph divisions map to ancient Greek lines.

The narrative generation runner uses the managed `codex-deepseek` runtime with its configured Infisical secret injection, ephemeral sessions, and read-only model sandbox. It sends only public-domain English source paragraphs. Batches are limited to 1,500 English words and 24 paragraphs, with at most four concurrent jobs, a 300-second per-attempt timeout, and one retry. Temporary cache keys include both a hash of each batch's IDs and exact source text and a hash of the translation instructions/glossary. Caches and prompts are outside the repository; only validated, approved JSON content is assembled into `public/data`. The note-English runner uses the same managed runtime and bounded concurrency (up to four workers), with batches of at most 40 notes or 3,500 Japanese characters, a 300-second per-attempt timeout, and one retry. Its cache identity includes each stable unit/note index, exact Japanese title/body, and the prompt hash. The complete 1,375-note English pass finished in 35 batches; public note metadata/order and Japanese text were preserved.

## Review coverage and recorded correction

The Japanese content remains an AI draft. A separate model-comparison run used the same 4 source paragraphs / 491 English words for DeepSeek and Claude outputs; it is not evidence that all four production-cache translations were reviewed and supports no general quality-winner claim. Three Claude production samples reviewed 98 distinct units / 11,718 English words: Iliad 49 units / 6,203 words and Odyssey 49 units / 5,515 words. The first covered Iliad books 1–16 first/last units (32 units; SHA-256 `d10355d1ad1cc848b83af16db8e93dc50330da6a32750029a69ae1f419897985`) and accepted findings in `iliad-04-0039`, `iliad-08-0001`, and `iliad-11-0055`; a proposed Ajax-note removal in `iliad-15-0054` was rejected because the preceding source unit identifies Ajax and the passage continues his speech. The second covered Iliad books 17–24 first/last units (16 units; SHA-256 `2f2f1d9be41450a2bdbac81e93f9eabdbfc291618c88057daf3775010a14858a`) and accepted a pronoun clarification in `iliad-21-0039`. The third covered Odyssey first/last units from all 24 books plus `odyssey-19-0019`, and `iliad-12-0005` (50 units / 6,138 words; SHA-256 `a7ec5701599accadca20816baa15a7f433c1356f2bfabf10dadd5e41db6b924c`); it accepted a spoiler correction in `odyssey-12-0001` and rejected a proposed removal in `odyssey-15-0048` because the preceding unit already describes Eumaeus's sale to Laertes. A separate earlier production check confirmed one ambiguity in `iliad-01-0002`: Butler's “Chryses his priest” means Chryses is Apollo's priest; `自分の祭司クリューセース` was corrected to `アポロンの祭司クリューセース`. Six accepted changes (five from the 98-unit samples and one separate earlier production check) are narrow, unit-specific corrections in [`scripts/translate-content-corrections.json`](scripts/translate-content-corrections.json), applied during validation and assembly. Exact reviewed IDs, sample hashes, and adjudication are recorded in that file. This is sampled AI review, not full-corpus review.

The English notes received a separate Codex-agent sample comparison of 137 distinct notes (pilot 40 plus a 102-note sample with five overlaps): the first and last note in all 48 books (96), all three spoiler-marked notes, and three of the longest Japanese notes. The review found no substantial omissions, additions, polarity errors, or repeated translation issue; it accepted two localized spelling corrections. In `iliad-01-0005#note-0001`, the mouse's name is corrected from “smintheus” to “sminthos,” distinguishing it from Apollo's epithet Smintheus; see Aelian, *On Animals* 12.5 ([English translation](https://www.attalus.org/translate/animals12.html)). In `iliad-23-0012#note-0001`, “Pthia” is corrected to “Phthia,” matching the adopted Butler text at `iliad-01-0016` and the established Japanese rendering. These exact corrections are recorded in [`scripts/translate-notes-corrections.json`](scripts/translate-notes-corrections.json). This was sampled comparison by a separate Codex agent, not full human proofreading; no claim is made that all 1,375 notes were reviewed.

## Reproduce and verify

Run the importer to download or reuse the raw source cache and create normalized temporary source files:

```bash
python3 scripts/import-content.py
```

Translate all units using the managed runtime, then validate and assemble the public data:

```bash
python3 scripts/translate-content.py --all --max-workers 4 --max-words 1500 --max-units 24 --timeout 300
python3 scripts/validate-content.py --assemble
python3 -m unittest discover -s tests/content -v
python3 scripts/validate-content.py --verify-published
```

Raw downloads, full excluded-text audit manifests, prompts, and translation caches are stored under `/tmp/homer-reader-*`. The public corpus contains `catalog.json`, `source-manifest.json`, and the 48 validated book files. The parser and published-manifest verification tests use local fixtures and run with Python's standard library; the command above does not require the temporary downloads.
