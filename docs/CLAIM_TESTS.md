# Claim check tests

Run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/claim-suite.mjs [runs] ["claim" ...]` (cache bypassed, live purchases).

## How it works
- **Where:** in a DM, any message with no link / tx hash / address is a claim (needs 3+ words). In a group, a claim is checked **only** when someone replies to it with `/check` (normal chat is never auto-checked; tested with fake Telegram updates in `src/bot/routing.test.ts`).
- **Round 1 (routed by Telegraph):** `FACT_CHECK_GENERAL` + `NEWS_SEARCH_GENERAL`.
- **Round 2 (only if two independent sources did not already agree):** `WEB_SEARCH_GENERAL` + `CONTENT_VERIFICATION_GENERAL`, each from the best-ranked miner not used yet (discovered from the leaderboard, never hardcoded).
- **Verdict (deterministic, one vote per miner):**
  - 🔴 *false*: 2+ sources say false (an explicit "False" verdict, or debunking words such as myth / hoax / misinformation / scam in a search answer) and none says true.
  - 🟢 *confirmed true*: 2+ say true and none says false, OR 1 says true, a credible source backs it, and nothing contradicts it.
  - **Trusted-source rule (Nov 24):** one answer is enough when at least one answer says false (or debunks), nothing says true, and a relevant link from a trusted domain (WHO, CDC, NHS, `.gov`, `.edu`, Reuters, AP, AFP Fact Check, Snopes, Full Fact, Africa Check, Dubawa, FactCheck.org, PolitiFact) was returned by ANY miner → 🔴. Reverse: one answer says true, nothing says false or mixed, same kind of trusted link → 🟢. A single "true" needs a trusted link (Wikipedia/Britannica/BBC do not count for that). A trusted link alone, without an opinion, stays 🟡. Links must pass the relevance filter (share key words with the claim).
  - 🟡 *unverified or mixed*: everything else, including "nobody could verify it".
- **Reasons:** max 3: one sentence + `N checks bought: 1 said it's true, 1 said it's false, 1 called it a myth or scam, 2 could not verify it.` ("said it's false" = explicit verdict; "called it a myth or scam" = debunking words, a weaker signal, worded differently).
- **Sources:** up to 3 links, **only real URLs the miners returned**, credible ones first (Wikipedia, Britannica, Reuters, AP, BBC, `.gov`, `.edu`, WHO, fact-checkers...). A link is dropped when its URL shares no meaningful word with the claim (before this filter the cash-ban claim showed "Say's law" and "OnlyFans").
- **Official Check line:** *Found on official/credible sources* (a source says true AND a credible, relevant source exists) · *Something close found* (a relevant source exists) · *Not found*.

## Final results (Nov 18, 2 runs per claim, ~$0.04 each, ~$0.62 total)
| Type | Claim | Run 1 | Run 2 | Notes |
|---|---|---|---|---|
| TRUE | Argentina won the 2022 FIFA World Cup. | 🟢 | 🟢 | one explicit "True" + Wikipedia pages; Official: *Found on official/credible sources* |
| TRUE | The Eiffel Tower is in Paris, France. | 🟡 | 🟡 | nobody gave a verdict; sources (Wikipedia, Britannica) are right |
| TRUE | Bitcoin has a maximum supply of 21 million coins. | 🟡 | 🟡 | nobody gave a verdict |
| FALSE | The Great Wall of China is visible from the Moon with the naked eye. | 🟡 | 🟡 | 1 explicit "false"; needs a second vote. Sources include Britannica "Can you see the Great Wall from space" |
| FALSE | Drinking bleach cures COVID-19. | 🔴 | 🔴 | 1 explicit "false" + 1 debunking answer; sources: CIDRAP, a university poison centre, Wikipedia "COVID-19 misinformation" |
| FALSE | Elon Musk is giving away 5000 BTC to anyone who sends 0.1 BTC... | 🟡 | 🟡 | 1 vote only; sources include Proofpoint "No such thing as free bitcoin" |
| VAGUE | The economy is going to crash soon. | 🟡 | 🟡 | correctly not decided |
| VAGUE | They say a new law will ban cash payments next month. | 🟡 | 🟡 | correctly not decided; sources are real cash-law articles |

Scorecard: **3 true claims → 1 🟢, 2 🟡 · 3 false claims → 1 🔴, 2 🟡 · 2 vague claims → 2 🟡.** No false claim was ever called true and no true claim was ever called false. Every false/hoax claim ended 🟡 or 🔴 (the demo criterion).

## Earlier runs (same day, before the fixes)
- Run A (1 run each, routed fact-check always went to miner 7420, which answers "Unverified" for nearly everything): **all 8 claims 🟡**, and the vague ones showed irrelevant source pages ("Say's law", "OnlyFans").
- Run B (after the relevance filter, ~$0.29): bleach 🔴, the rest 🟡. Vague claims said "One source says this claim is false" from a single debunking word: that wording was fixed (it now says "calls this claim a myth or scam" and counts separately).

## Known limits (read before the demo)
- **The result depends on which miner Telegraph routes Round 1 to.** Run A was routed to a miner that never decides; the final runs were routed to one that does. Same claims, different outcomes. A deterministic Round 1 (top-ranked miners, like Round 2) would remove this but the brief says routed.
- **True claims rarely reach 🟢.** The fact-check miners mostly answer "Unverified" ("No usable source evidence was retrieved"). We never turn search text into "true" (no LLM, no guessing); only an explicit verdict from a miner can.
- Two debunking sources are needed for 🔴, so many hoaxes stay 🟡 even when the returned sources clearly debunk them (Great Wall, Musk giveaway).
- "Debunking words" are keyword matches in search answers. A headline like "Americans still drinking bleach to cure Covid" is not counted; "tenaciously incorrect facts" is. It is a weak signal, never enough alone.
- Claims are cut to 500 characters before they are sent to miners. Non-English claims were not tested.
- The unranked "do-everything" miners (a1-preflight, chainsight...) have no per-intent score right now, so Round 2 never picks them even though a1-preflight answered "True" correctly in an early survey.


## Re-run Nov 24 (looser trusted-source rule, 1 run per claim, ~$0.32)
| Claim | Result | Why |
|---|---|---|
| Drinking bleach cures COVID-19. | 🔴 | a "myth" answer + the CIDRAP (`.edu`) page returned by another miner |
| Argentina won the 2022 World Cup | 🟡 | no miner gave a "true" answer this run (was 🟢 on Nov 18; miner answers vary) |
| Eiffel Tower / Bitcoin 21M | 🟡 | nobody gave a verdict |
| Great Wall visible from Moon | 🟡 | 1 "false" but only Wikipedia links (not trusted) |
| Musk 5000 BTC giveaway | 🟡 | 1 "false", only Wikipedia links |
| Vague claims (economy crash, cash ban) | 🟡 | nobody could verify |
No claim reached 🟢 this run.

## Future events and questions (Nov 24)
- **Future events** ("…tomorrow", "next week", "will", "going to", "soon", "upcoming") are never 🔴/🟢: 🟡 *"We couldn't find reliable info on this yet."*
- **Present-tense questions** ("Is drinking bleach a cure for COVID?", "Is this Elon giveaway real?") are judged like the claim inside them, with the same trusted-source rule. Bot headline: 🔴 *"No, this is false."* / 🟢 *"Yes, this is true."*; statements keep "This is false." / "This looks true."
- "One website says it is false" only appears for an explicit false verdict, not myth wording. Tests: `claims.test.ts`, `simple.test.ts`.

## Question rewrite (Nov 24)
Before buying, a present-tense question is rewritten into a statement with simple rules (no LLM): "Is X a cure for Y?" → "X cures Y", "Is this giveaway real?" → "This giveaway is real", "Does X cure Y?" → "X cures Y", "Can X…" → "X can…", "Has X been…" → "X has been…". Unknown shapes only lose the "?". Miners get the statement; the check keeps the original wording for the reply. Future events are still judged on the original text. Live check: "Is drinking bleach a cure for COVID?" went from 🟡 to 🔴 "No, this is false." (CIDRAP `.edu` link + one "false" answer, $0.04).
