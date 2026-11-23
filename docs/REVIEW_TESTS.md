# Reviews / reputation tests

Run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/review-suite.mjs [--link-only] [domain ...]` (cache bypassed, live purchases).

## What it does
- **In every link check** (not for popular sites): one extra line, `Reviews: ...`, with up to 2 real source links. It is one of the 3 reasons.
- **Standalone:** `/reviews <business name or website>` (also as a reply in a group). Result page at `/c/:id`.
- **Never invents anything.** Every link and source name shown was returned by a miner. No rating is shown unless the answer literally contains one ("4.8/5").
- **Verdict effects (links):**
  - scam reports about the site = **one flag** (like the brand check), so with one paid flag it becomes 🔴, alone it stays 🟡;
  - **"Reviews: none found." is a neutral info line only (changed Nov 23, evening).** It never changes the verdict by itself. Every real warning sign (a flag, disagreement, too few answers, a very new domain, a brand look-alike) already gives 🟡 on its own, so "none found" only ever appears next to them. Popular sites skip the whole review check;
  - "generally positive", "mixed" and "none found, but credible sources describe it" are information only.
- **Standalone verdict:** 🔴 only with two independent kinds of evidence, 🟡 with one or none, 🟢 only if the text found is positive.
- **Cost:** 3 purchases (~$0.03). A non-popular link check is now ~$0.07 (was ~$0.04); the "N checks bought" line counts them ("7 checks bought: 2 found no threat, 2 couldn't check this link, 3 for reviews and news").

## What Telegraph actually offers (why it is built this way)
- **There is no review/reputation intent** for sites or businesses (only `THREAT_IP_REPUTATION_GENERAL`, for IP addresses).
- **`VENDOR_VERIFY_GENERAL` is not used:** it requires `vendor` AND `vat_number`, which a link does not have.
- **`WEB_SEARCH_GENERAL` miners are not search engines.** Surveyed all 30: most are Wikipedia / Crossref / Zenodo / Hacker News wrappers or stubs. **None returned Trustpilot, Reddit or any review site.** Routed searches always went to miner 303, which returns a Wikipedia page title. We still buy the two searches you specified (`<domain> reviews`, `<domain> scam`): their value is mostly "a credible page about this entity exists".
- **The useful one is an adverse-media screening miner** (`NEWS_SEARCH_GENERAL`): "3 adverse news items naming BitConnect ... mainly criminal, litigation, fraud (Law360, TradingView, India Today)". It is found by what it does (its description), not by a fixed id. It gives source **names**, not links, so names are shown as text.

## Safeguards (each one came from a real failure)
- **Query echo.** Some miners repeat the query back ("plausible.io scam"). The query text is removed before looking for "scam" words.
- **Ordinary-word brand names (found in testing).** The first run called the legitimate site **plausible.io** "scam reports and adverse news found (CBS News, Repairer Driven News)" and the standalone check gave it 🔴. The adverse-media miner had matched the English word "plausible" in an unrelated court headline ("...shows plausible widespread practice"). Fix: evidence only counts if it contains the **full domain or a multi-word name**; a single-word brand name needs corroboration from a credible page **titled exactly** that name (Wikipedia "Bitconnect" yes, "Plausible Analytics" no). Regression tests cover both.
- **Links must name the entity.** The first run showed a Wikipedia page about *Pinterest* as a source for *pinboard.in*: every link of an answer that mentioned the name was kept. Now each link must itself contain the entity name.
- **Generic labels** ("login", "secure", "wallet"...) never count as a match by themselves.

## Results (Nov 23, final run: each domain through the link check and the standalone check, ~$0.66)
| Group | Domain | Link check | `/reviews` | Reviews line |
|---|---|---|---|---|
| Scam | bitconnect.co | 🟡 | 🟡 | "scam reports and adverse news found (Law360, TradingView, India Today)" + Wikipedia *Bitconnect* link. Only one kind of evidence, so not 🔴 |
| Scam | onecoin.eu | 🟡 | 🟡 | "No reviews found": **a miss** (OneCoin is a notorious scam; no miner knows the domain) |
| Scam | paypa1-secure-login.verify-account.xyz | 🔴 | 🟡 | "No reviews found"; the 🔴 comes from the brand check (PayPal) + a paid flag |
| Small legit | plausible.io | 🟡* | 🟡 | none found, but credible sources describe it (Wikipedia *Plausible Analytics*) in the standalone run; "No reviews found" in the link run (the search answers differ per run). **No false accusation** |
| Small legit | pinboard.in | 🟡 | 🟡 | "No reviews found" |
| Small legit | buttondown.com | 🟡 | 🟡 | "No reviews found" |
| Popular | google.com, github.com, wikipedia.org | 🟢 | n/a | skipped on purpose: $0.02 each, no review purchases |

Scorecard: popular sites 3/3 🟢 and unchanged in cost. Scam domains: 1 of 3 shows real scam reports (BitConnect), 1 is 🔴 via the brand check, 1 is a miss. Legit small sites: **0 of 3 reach 🟢 any more** (all 🟡), and none is accused.

## Softer rule (Nov 23, evening)
\* The table above is the run with the **old** rule ("no reviews" made a clean link 🟡). With the new neutral rule the three small legit sites, whose scans were all clean (4 of 4 found no threat), would be 🟢 with the line "Reviews: none found." I did not re-run them live (credit); the rule is covered by unit tests (clean scans + none found = 🟢; any real warning sign = 🟡 with or without it). The standalone `/reviews` check still ends 🟡 "Reputation unclear" when nothing is found, because reputation is the only question there.

## Known limits and trade-offs (read before the demo)
- **A site with no online presence at all now gets 🟢 if both scans are clean.** Telegraph has almost no review data, so "none found" says little either way; the scans and the brand / age / flag checks are what protect the user.
- Review quality is limited by the miners: no star ratings, no review-site links in practice. The adverse-media miner only knows large news outlets, so most scams are not found.
- The result varies a little between runs because routed searches reach different miners.
