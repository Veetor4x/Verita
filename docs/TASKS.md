# Verità — Tasks

## HANDOFF (read first) — end of session 1, Nov 18

**Done**
- PR #1 merged (rename, CLAUDE.md, README, TASKS). Everything below is on branch `claude/elegant-cray-796us8`, not yet merged.
- `backend/` skeleton (`verita-backend`), `shared/types.ts`, `.env.example`, config.
- `scripts/setup-wallet.mjs` (prints address + balances, mints test USDC, never prints the key).
- Telegraph client `src/telegraph/client.ts`: **escrow first, x402 per-call fallback** (`PAYMENT_MODE=auto|escrow|x402`). Tested live on escrow: 200, `signal_hash` + `receipt_hash` decoded.
- `discovery.ts`, `receipts.ts`, Neon layer (`src/db`, `schema.sql`), link engine (`extract`, `planner` with Round 1 → Round 2, `verdict` + 9 passing unit tests), `scripts/check-link.mjs`, `scripts/test-purchase.mjs`.
- Wallet/escrow (Nov 18 evening): escrow topped up to $8.25 deposited (about $5.5 available, 550 calls at $0.01); burner wallet about 1.75 USDC + 0.055 Sepolia ETH left. Render `MAX_SPEND_PER_DAY_USD=10` (set Nov 18). See `docs/RECEIPTS.md`.

**Next (in order)**
1. New session so `DATABASE_URL` is picked up (it was a placeholder). Test Neon: `NODE_USE_ENV_PROXY=1 npx tsx scripts/_dbcheck.mjs` (recreate it if missing: `migrate()` then list tables).
2. `NODE_USE_ENV_PROXY=1 npx tsx scripts/test-purchase.mjs` → saves the first receipt to Neon; copy the hashes into `docs/RECEIPTS.md`.
3. `NODE_USE_ENV_PROXY=1 npx tsx scripts/check-link.mjs <known-bad link>` → check that the answer fields parse (`toSignal` in `verdict.ts` is untested on real THREAT_INTELLIGENCE_INDICATOR answers) and that Round 2 triggers. Tune the intent params (`indicator`) after reading the intent's `request.params` from `/engine/v1/intents/THREAT_INTELLIGENCE_INDICATOR`.
4. Open PR, merge it. Then Nov 19: Telegram bot (DM + group guard), Express server, deploy to Render.
5. Top up escrow when low: `NODE_USE_ENV_PROXY=1 node --disable-warning=ExperimentalWarning backend/scripts/deposit-escrow.mjs 1` (approves, then calls `depositUSDC`).

**Gotchas**
- **`NODE_USE_ENV_PROXY=1`** is required for any Node network call in this container (Node 22 ignores `HTTPS_PROXY` otherwise). Add `--disable-warning=ExperimentalWarning` to hide the noise.
- **RPC:** only `https://ethereum-sepolia-rpc.publicnode.com` is reachable here (viem's default and most others are blocked with 403).
- **Escrow header format:** resend the 402'd request with `X-PAYMENT` = base64 of `{x402Version:2, scheme:"escrow", network, payload:{signature, authorization:{from,to,value,validAfter,validBefore,nonce}}}`. The signature is a `personal_sign` of `extra.message` from the challenge with `{from}` **lowercased**, `{nonce}`, `{validAfter}`, `{validBefore}` filled in. Window must be 2 minutes at most. Reference: `telegraphprotocol/telegraph-mcp` `src/pay.ts`.
- **Receipts on escrow:** `receipt_hash` is in the `X-PAYMENT-RESPONSE` header (base64 JSON), `signal_hash` is in the body. There is **no `X-TELEGRAPH-RECEIPT`** header. The receipt's `miner` can differ from the body's `miner_id`; we store the body's. Escrow settles per 3-hour epoch on Telegraph's ledger, so there is no per-call Sepolia tx. Ask the organisers whether that counts as "on-chain".
- **Escrow balance:** `GET /v1/ledger/account/{wallet}` (no `/engine` prefix). If escrow reports "insufficient", the client skips escrow for 5 min and falls back to x402.
- **x402** signing works, but `facilitator.x402.rs` timed out on every settle today (Telegraph-side). Fallback may not work until it recovers.
- **x402 client API:** `new x402Client({...})` takes a selector, not a config; use `x402Client.fromConfig({schemes: [], spendControls})`. Test USDC is not a "default asset", so it needs an `allowedAssets` entry.
- **TypeScript 7:** `tsconfig` needs `"types": ["node"]`. tsx scripts need top-level await in `.mjs` files (not `-e`).
- **Intent names:** `/intents/{X}` returns 200 for wrong names; check `miner_count`. Request body to `/ask` is `{intent, params}` (or `{query}`); routed answers return `miner_id`, `result`, `field_status`, `signal_hash`, `cost_usd`.
- **Scratch scripts** `backend/scripts/_*.mjs` are git-ignored (`_dbcheck`, `_escrow`, `_chain`, `_askcheck`). Never print or log `EVM_PRIVATE_KEY`.

---
Status: ⬜ todo · 🔄 in progress · ✅ done · ❌ cut
Plan source: CLAUDE.md section 11. Update this file whenever a task changes status.
Rule: if link check + bot aren't working by Nov 20, drop all NICE items and the payment check becomes NICE.

## Nov 18 — Rename + first paid call + link engine
- ✅ Rename project to Verità (CLAUDE.md, README, docs)
- ✅ Project skeleton: `backend/` (package `verita-backend`), tsconfig, `.env.example`, `shared/types.ts`
- ✅ Wallet setup script (`scripts/setup-wallet.mjs`, burner testnet wallet)
- ✅ Telegraph client: discovery (intents, miners, prices) + paid `/ask` via escrow, x402 fallback, spend controls
- ✅ First real paid call on escrow + receipt saved in Neon (see docs/RECEIPTS.md)
- ✅ Neon schema (`checks`, `purchases`, `cache`, `spend`)
- ✅ Link check engine: planner with escalation (Round 1 → Round 2) + deterministic verdict (verified live on a known-bad link)
- ✅ False-alarm fixes (Nov 18): bundled popular-domain list (google.com never 🟡), majority vote after escalation, one vote per miner, Round 2 miners chosen by leaderboard rank, "unknown is not safe" (see docs/LINK_TESTS.md). No reliable 🔴-after-escalation demo link yet: find a live phishing URL from OpenPhish/PhishTank on demo day
- ✅ Brand-impersonation signal (`src/engine/brands.ts`, start of the Official Check): a host that contains a known brand (metamask, binance, paypal/paypa1, uniswap, coinbase, opay, ~30 brands) but is not one of its official domains counts as ONE flag with the reason "Pretends to be <Brand>, but isn't the official site (<domain>)". Alone → 🟡, plus any miner flag → 🔴. `officialCheck` is FOUND for official domains, CLOSE for impersonation. Official domain lists are hand-written: add any missing official domain to `BRANDS` when it causes a false 🟡
- ✅ Cache cutoff `config.cacheValidFrom`: bump it whenever verdict rules change so old cached verdicts are ignored
- ✅ Honest counts (Nov 18): reasons end with "N checks bought: X flagged it, Y found no threat, Z couldn't check this link." built from the purchases (never "1 of 2 sources" when 4 were bought); brand check is listed separately and never counted as bought
- ✅ Wallet: minted +20 test USDC (wallet 21.75 USDC); `setup-wallet.mjs <amount>` always mints that amount
- ✅ Link polish: brand + paid flag no longer repeats "a source we paid also flagged it" (the "N checks bought" line says it)
- ✅ Ranking fix: when the current epoch's leaderboard has no row for an intent (it is nearly empty right after an epoch change), fall back to each miner's own latest score from `/api/miners?intent=X`. Unscored "do-everything" miners (a1-preflight, chainsight) sort last
- ✅ Bot routing is unit-tested with fake Telegram updates (`src/bot/routing.test.ts`): normal group chat is never checked

## Nov 19 — Bot + deploy
- ✅ Telegram bot, DM mode (webhook, secret check) — tested locally with simulated updates
- ✅ Group guard code done; BotFather privacy disabled (needs a live test in a real group)
- ✅ Deploy to Render: https://verita-znay.onrender.com, secrets set, `/health` = 200, Telegram webhook set (`/telegram/webhook`, 0 pending, no errors). UptimeRobot ping on `/health` still todo

## Nov 20 — SHOWCASE
- ⬜ Demo: scam link posted in a group → automatic 🔴 + receipts

## Nov 21–23 — More checks
- ✅ Claim check (Nov 18): DM = any message with no link/tx/address; group = only when replying with `/check`. R1 FACT_CHECK + NEWS_SEARCH (routed), R2 WEB_SEARCH + CONTENT_VERIFICATION from top-ranked miners. 🟢 true / 🟡 unverified or mixed / 🔴 false, max 3 reasons, up to 3 real source links (relevance-filtered), Official line. Results in docs/CLAIM_TESTS.md. **Known limit: with today's miners almost every claim ends 🟡; true claims never reached 🟢**
- ✅ Payment check, basic (Nov 18): tx hash or address → network, from → to, wallet vs contract (🟡 if contract), amount + USD, status. Free RPC for network/contract + paid lookup/price/(risk). Results in docs/PAYMENT_TESTS.md. **Known limits: mainnet RPC untested live (blocked in the build sandbox); scam-tagged wallets are not detected**
- 🔄 Official Check (FOUND / CLOSE / NOT_FOUND): links = brand list + "Official site" button (done); claims = "Found on official/credible sources" / "Something close found" / "Not found" (done, source links must relate to the claim); still todo: web-search part for links (WEB_SEARCH_GENERAL, VENDOR_VERIFY_GENERAL)
- ⬜ Cache (24h per normalised input) and spend caps (per check + per day)

## Nov 23 — Extra features (new features STOP after Nov 27)
- ✅ Reputation / reviews (Nov 23): `Reviews:` line in every non-popular link check (+ up to 2 real links), `/reviews <name or site>` standalone. No review intent exists on Telegraph; built from an adverse-media miner (found by capability) + `WEB_SEARCH_GENERAL` "<domain> reviews" / "<domain> scam". "No reviews found" = one 🟡 reason, never a lone 🟢; popular sites skip it. Results and the plausible.io false-accusation fix in docs/REVIEW_TESTS.md. **Trade-off: legit small sites now end 🟡; link checks cost ~$0.07**
- 🔄 Images / screenshots (next). Findings so far: Telegraph rejects requests over 16 KB (no base64); no extraction miner can read text in an image; most image-verification miners are stubs

## Nov 24–25 — Web pages
- ⬜ `/` paste box + explainer
- ✅ `/c/:id` verdict card + "More details" (miners, cost, receipts): mobile-first redesign (Nov 18), dark mode, tap-to-verify hashes, "Official site" button
- ✅ `/stats` public page + `/api/stats`: checks run, USDC spent, receipts, escalated, latest 10 signal hashes (link to Telegraph verify)
- ⬜ `/api/check`, `/api/check/run`, `/api/check/:id`, rate limiting, input validation

## Nov 26–27 — Tune
- ⬜ Test each intent with known-bad / known-good inputs; tune miners
- ⬜ Make escalation visible (Round 2 shown in bot + `/c/:id`)
- ⬜ NICE (only if all MUSTs work): share card, lookalike-address warning, report scam, `/stats`, escrow

## Nov 28 — Docs
- ⬜ README run instructions + receipts
- ⬜ Switch back to Claude chat for submission materials

## Nov 29–30 — Submission prep
- ⬜ Record 2–5 min demo video
- ⬜ Collect signal hashes / receipts
- ⬜ Commercial summary
- ⬜ Star github.com/telegraphprotocol/bounties

## Dec 1 — Submit
- ⬜ Submit before 23:59 UTC (buffer only)

## Demo "done" criteria (CLAUDE.md section 12)
- ⬜ Scam link in group → 🔴 within ~15s, 3 reasons, "More details" link
- ⬜ `/c/:id` shows miners, cost, real signal/receipt hashes that verify
- ⬜ At least one visible Round 2 escalation
- ⬜ Fake news claim → 🟡/🔴 with sources + found/close/not found
- ⬜ Sepolia tx → network, wallet vs contract, USD amount
- ⬜ Repeat check served from cache at $0
- ⬜ Live on Render; README has run instructions

## Open risks / admin
- ⬜ Update hackathon team registration to solo ("one team, one identity")
- ⬜ Confirm payout eligibility for Nigeria with organisers
