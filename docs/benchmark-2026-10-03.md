# Benchmark, 3 October 2026

Build 390ec1b (the code this repository was first exported from), packaged and run on an Apple-silicon Mac with an
OpenAI key and the default models: `gpt-6-luna` proposes actions, `gpt-6-sol` runs the final checks. Each task
started from a fresh Carve profile and a fresh browser profile.

**Grading.** Pass criteria were written before any run. A run is *verified* only when every part of the answer or
change was checked: against the page text Carve captured, the saved file on disk, or the live page itself for
live-site tasks. *Partial* means part of the task was done or answered and Carve said what was missing. *Stopped*
means Carve stopped and said it could not finish, and changed nothing it should not have. *Wrong* means Carve said
"done" and it wasn't. The test pages and the harness that drives the longer tasks are not in this repository yet.

## Short tasks on websites: 20 tasks × 3 runs

A fixed set first written for a 29 September check. 51 verified, 7 partial, 1 unconfirmed (right, but the pages it
saw did not show it), 1 with no answer, **0 wrong**. Time to result: 12.5 s median, 24.2 s at the 90th percentile.

| Site | Request | Runs | Notes |
|---|---|---|---|
| apnews.com | What is the lead story on this page right now? | verified · verified · verified |  |
| cookieandkate.com | What ingredients do I need for this, and how long does it take? | verified · verified · verified |  |
| merriam-webster.com | What does this word mean, and when was it first used? | verified · verified · verified |  |
| kernel.org | What is the latest stable Linux kernel version on this page? | verified · verified · verified |  |
| imdb.com | What is this movie’s IMDb rating and runtime? | verified · verified · verified |  |
| goodreads.com | What is this book’s average rating, and how many ratings does it have? | verified · verified · verified |  |
| metacritic.com | What are this game’s Metascore and user score? | verified · verified · verified |  |
| packagist.org | How many total installs does this package have, and what is its latest version? | verified · verified · verified |  |
| nuget.org | What is the latest version of this package, and how many total downloads does it have? | verified · partial · verified | named 14.0.1-beta2 "the latest version" without saying it is a prerelease (r1 said so; r3 gave the stable 13.0.4 and noted the prerelease). |
| pkg.go.dev | What is the latest version of this module, and when was it published? | verified · verified · verified |  |
| base64encode.org | Encode the text "hello carve" here and tell me the result. | verified · verified · verified | result read from the page text Carve observed ("…into the area below.aGVsbG8gY2FydmU="). |
| unitconverters.net | Convert 26.2 miles to kilometers on this page and tell me the result. | verified · verified · verified |  |
| convertcase.net | Type "the quick brown fox" into the box, make it Title Case, and tell me the result. | verified · verified · verified | r2 proven from observations; r1, r3 visible in the final screenshot. |
| epochconverter.com | Convert the timestamp 1700000000 to a date here and tell me the GMT result. | no answer · verified · unconfirmed | guide route: "I’ll convert 1700000000 on this page…" and no result. correct GMT value, but nothing was entered on the page (inputs 0); not established from the page. |
| nuget.org | What is the latest version of the package Carve.Quartz.Nonexistent2026? | verified · verified · verified |  |
| merriam-webster.com | What does this page say about how the word is used in chemistry? | partial · partial · partial | a real example on the page (materials research, "trial and error") framed as chemistry-related; did not say the page has no chemistry sense. |
| php.net | When does security support for PHP 8.1 end? | verified · verified · verified |  |
| kernel.org | When does the 6.1 longterm kernel reach end of life? | verified · verified · verified |  |
| nuget.org | When was the latest version of this package released? | partial · partial · partial | gave the version and its "Last updated 13 days ago" but declined to call it a release date. |
| bing.com | What was the Oxford Word of the Year for 2023? | verified · verified · verified | web route; the cited OUP page was re-fetched and both claims supported (web.source_support_checked). |

## Longer tasks: 23 tasks × 2 runs

25 verified, 1 complete but not fully checkable, 9 partial, 8 stopped, 1 with almost no answer, **2 wrong** (the same
bug twice).

| Task | Run 1 | Run 2 | Notes |
|---|---|---|---|
| Research two options, follow up, correct a fact, compile into a saved document (TextEdit) | verified | verified | saved; fit statement correct (Harbor fits, $10 left; Lantern $25 over); follow-up day passes added / saved + follow-up day passes added; fit statement correct |
| Fresh variation: shared kitchens, same journey | partial, said so | partial, said so | router inverted roles (doc = reference, fresh Chrome = workspace) → edit stage on Google homepage; said so on its failure card. Fixed since / saved ✓, follow-up single-day rates ✓; turn-2 question ('is cold storage included, where do I park?') answered for Copper only, and the file says so — Marrow's cold storage/parking missing |
| Fresh variation 2: photography studios, same journey (exit test) | partial, said so | verified | router asked for a source in Carve itself; intent check rejected rebound route. Fixed since / saved + follow-up half-day rates added; fit statement correct (Blue Door fits, $20 left) |
| understand a long spec sheet (Aster 14 battery and warranty) | verified | verified |  |
| supported versions below the fold (angular.dev releases) | verified | verified | live angular.dev/reference/releases: 22/21/20 supported, v20 LTS ends 2026-11-28 / same as r1, matches live page |
| compare two pricing pages (annual discount in a footnote) | verified | verified |  |
| dated-fact comparison (newest Lua vs newest Node.js LTS) | verified | verified | Node v24.21.0 "September 8" = the cited release post (2026-09-08); dist index says 09-07 / Sept 8 matches the nodejs/node GitHub release it cited (published 2026-09-08); Lua from lua.org |
| change one setting with a native select and save | verified | verified |  |
| searchable comboboxes with a 4 px input (department, dependent country/city) | stopped, said so | stopped, said so | searchable combobox (known gap) / searchable combobox (known gap) |
| Lead form whose title field is named only by its placeholder (CRM recording) | verified | verified | placeholder-only fields, all 5 right, one save |
| two precise edits in a 1,200-character TextEdit note, saved | WRONG | WRONG | final newline dropped via fill path; fixed since / final newline dropped again (fixed since) |
| move receipts by the year on their first line (Finder) | stopped, said so | stopped, said so | "Partly done… No receipts were moved"; nothing changed / no receipts moved, said so |
| compare, follow up, correct the budget, save as Bikes.txt | stopped, said so | verified | research turns right; turn 3 deadline, no Bikes.txt / research → Bikes.txt saved with all facts (r1 ran out of time) |
| note to task app (three action items with owners) | verified | stopped, said so | 'Choose the document to continue' card before any task was created; no tasks added, nothing changed |
| Stop mid-form, Continue with a changed quantity, one order | verified | verified |  |
| correction, capsule minimize/restore, sign-in hand-off, new conversation | partial | partial | only miss: capsule minimize/restore step / capsule minimize/restore step only |
| Return-policy exceptions (Best Buy vs Apple, opened headphones) | partial, said so | almost no answer | Apple 14 days / original condition / no fee stated — correct, cited; Best Buy page gave no policy text and Carve said so instead of guessing / source-support filter removed all 11 details; answer is one framing sentence. Not false, not useful |
| Changing shopping constraints (Kohl’s carry-ons) | partial, said so | complete, not fully checkable | correction applied; 2 softside items + prices verified in page text; a valid third (Rockland Melrose $84.99) was on the page but missed; card said 'Partly done' / turn 1 three items + prices match page; correction turn: two softside items match the results page; the third's $89.99 / 20-inch is from a product page not captured (results page shows that line from $89.99) |
| Annual-report PDF (LEGO Group revenue change) | stopped, said so | stopped, said so | LEGO annual report: searched lego.com, did not reach the report; 'Needs your help', no figures claimed / reached the LEGO newsroom; said it had not verified the report or figures |
| Announcement versus availability (Claude Opus 5.5 in GitHub Copilot) | verified | verified | Copilot Opus 5.5: plans, gradual rollout, admin default-enablement all match the live changelog; Free/Student auto-only matches the docs page / matches the live changelog (plans, clients, gradual rollout, admin policy) and docs |
| Evidence-based follow-up (three iPads) | verified | verified | iPad mini $599/8.3"/0.65 lb/A17 Pro, Air 11 $749/1.02 lb/M4, iPad $449/1.05 lb/A16 — match apple.com; follow-up lightest + trade-off correct / all specs incl. cellular weights 0.66/1.03/1.06 lb match apple.com compare; follow-up correct |
| Impossible match (MacBook: 15-inch+, < 3 lb, < $1,200, >= 24 GB) | partial, said so | partial, said so | right that none qualifies on what it checked (Neo $699 13", Air from $1299 — match page); did not reach Pro specs and said so / "I haven't completed the comparison yet": Neo $699, Air $1,299, Pro $1,999 starting prices; per-model misses not finished |
| Dependent searchable dropdowns, then change the country | verified | verified | dependent dropdowns + correction: US saved, then CA/ON/London after correction |

## Since then

The two wrong reports and both failed follow-up edits had causes that we fixed after the run. The fixes are in this
code, and the cases were run again on the fixed builds:

| Fix | Cases run again | Result |
|---|---|---|
| A follow-up edit of a saved document now reads the conversation's earlier pages, and the document is always the one written (the router had asked for Carve itself as a source, or made the document read-only) | D01, D02, D03 × 2–3 runs | Saved 8 of 8, follow-up change applied 8 of 8; 6 of 8 fully verified (in two D02 runs a question about both kitchens was answered for one, and the file says so) |
| A whole-document rewrite keeps the final line break | A-N1 × 2 | 1 exact; 1 kept the line break but reworded a line nobody asked about, and said "saved" |
| The write check names lines changed beyond the request, and Carve is sent back once to restore them; trailing spaces the original did not have are dropped | A-N1 × 3 | 3 of 3 exact |

One run (D03, first build) was lost to the test harness and is not counted.
